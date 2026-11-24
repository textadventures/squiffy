// The story map (#615): the editor's map of the story, in a webview beside the text (the page is
// src/map/, bundled into dist/map/). Redrawn as you type, it follows the story of the active
// .squiffy editor, highlights the section the cursor is in, and goes to a section or passage when
// it's clicked. A link dragged from one box to another is added to the text as an edit, so Undo
// takes it out. Where boxes are dragged to is kept in squiffy.json, as the editor keeps it, or
// until the map's closed for a story without one.

import * as vscode from "vscode";
import type { BaseLanguageClient } from "vscode-languageclient";
import { parseProjectFile, updateProjectFile, type MapPositions } from "squiffy-compiler";
import type { Location, StoryGraph } from "squiffy-compiler/language-service";
import { movedNodes, nodeAtLine, renamePositions } from "@textadventures/squiffy-app/story-map";
import { STORY_GRAPH, type StoryGraphParams, type StoryGraphResult } from "../protocol.js";
import type { FromMap, ToMap } from "../map/messages.js";
import { linkEdit, movedPositions, type Cursor } from "./map-edits.js";

// How long to wait after typing before drawing the map again
const UPDATE_DELAY = 300;

export class StoryMap implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    // A file in the story being shown
    private storyUri: vscode.Uri | undefined;
    // The story's folder, as a URI ending "/"
    private root: string | undefined;
    private projectFile: vscode.Uri | undefined;
    private graph: StoryGraph | undefined;
    private positions: MapPositions | undefined;
    // Positions for stories without a squiffy.json, by their folder, while VS Code's open
    private sessionPositions = new Map<string, MapPositions>();
    // The last .squiffy editor in the story: where the cursor is, and where to go to things
    private editor: vscode.TextEditor | undefined;
    private updateTimer: ReturnType<typeof setTimeout> | undefined;
    // Graphs are read and positions written one at a time, so they land in order
    private queue: Promise<void> = Promise.resolve();
    private disposables: vscode.Disposable[] = [];

    constructor(private client: BaseLanguageClient, private extensionUri: vscode.Uri) {
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(e => {
                if (this.isInStory(e.document.uri) && e.contentChanges.length) this.scheduleUpdate();
            }),
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (!this.panel || editor?.document.languageId != "squiffy") return;
                // Another story's file: show that story instead
                if (!this.isInStory(editor.document.uri)) {
                    void this.show(editor.document.uri, false);
                    return;
                }
                this.editor = editor;
                this.sendCurrent();
            }),
            vscode.window.onDidChangeTextEditorSelection(e => {
                if (e.textEditor.document.languageId != "squiffy" || !this.isInStory(e.textEditor.document.uri)) return;
                this.editor = e.textEditor;
                this.sendCurrent();
            }),
        );
        // Files changed outside the editor, added or deleted
        const watcher = vscode.workspace.createFileSystemWatcher("**/*.{squiffy,css,js,json}");
        const changed = (uri: vscode.Uri) => {
            if (this.isInStory(uri)) this.scheduleUpdate();
        };
        this.disposables.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
    }

    private isInStory(uri: vscode.Uri) {
        return !!this.panel && !!this.root && uri.toString().startsWith(this.root);
    }

    // Shows the map of the story a file is part of
    async show(uri: vscode.Uri, reveal = true) {
        // Not a squiffy.json, which has no sections for the cursor to be in
        const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() == uri.toString() && e.document.languageId == "squiffy");
        if (editor) this.editor = editor;
        this.storyUri = uri;
        if (!this.panel) this.createPanel();
        else if (reveal) this.panel.reveal(vscode.ViewColumn.Beside, true);
        this.update();
        await this.queue;
    }

    private createPanel() {
        const dist = vscode.Uri.joinPath(this.extensionUri, "dist", "map");
        const panel = vscode.window.createWebviewPanel("squiffy.map", "Story Map", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [dist],
        });
        panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "images", "icon.png");
        const webview = panel.webview;
        webview.html = mapHtml(webview.cspSource, webview.asWebviewUri(vscode.Uri.joinPath(dist, "map.js")), webview.asWebviewUri(vscode.Uri.joinPath(dist, "map.css")));
        webview.onDidReceiveMessage((message: FromMap) => this.receive(message), undefined, this.disposables);
        panel.onDidDispose(() => {
            this.panel = undefined;
            this.root = undefined;
            this.graph = undefined;
            void vscode.commands.executeCommand("setContext", "squiffyMapOpen", false);
        });
        void vscode.commands.executeCommand("setContext", "squiffyMapOpen", true);
        this.panel = panel;
    }

    private post(message: ToMap) {
        void this.panel?.webview.postMessage(message);
    }

    private receive(message: FromMap) {
        switch (message.type) {
            case "ready":
                // The page has (re)loaded, so it needs the whole graph again
                this.graph = undefined;
                this.update();
                break;
            case "goto":
                void this.goto(message.location, message.focus);
                break;
            case "link":
                void this.link(message.from, message.to);
                break;
            case "move":
                this.move(message.moves);
                break;
        }
    }

    private scheduleUpdate() {
        clearTimeout(this.updateTimer);
        this.updateTimer = setTimeout(() => this.update(), UPDATE_DELAY);
    }

    private update() {
        clearTimeout(this.updateTimer);
        this.queue = this.queue.then(() => this.refresh()).catch(e => console.error("Couldn't draw the story map", e));
    }

    private async refresh() {
        if (!this.panel || !this.storyUri) return;
        const result = await this.client.sendRequest<StoryGraphResult>(STORY_GRAPH, { uri: this.storyUri.toString() } satisfies StoryGraphParams);
        if (!this.panel) return;
        const before = result.root == this.root ? this.graph : undefined;
        this.root = result.root;
        this.projectFile = result.projectFile ? vscode.Uri.parse(result.projectFile) : undefined;
        if (this.editor && !this.editor.document.uri.toString().startsWith(this.root)) this.editor = undefined;
        let positions = await this.readPositions();
        // Renamed sections and passages keep their places
        const renamed = before ? movedNodes(before, result.graph) : [];
        const moved = before && renamePositions(positions, before, result.graph);
        if (moved) {
            positions = moved;
            await this.savePositions(moved);
        }
        this.graph = result.graph;
        this.positions = positions;
        this.post({ type: "graph", graph: result.graph, positions, renamed });
        this.sendCurrent();
    }

    // The section or passage the cursor is in
    private sendCurrent() {
        if (!this.graph || !this.root) return;
        const cursor = this.cursor();
        const id = cursor ? nodeAtLine(this.graph, cursor.file, cursor.position.line)?.id ?? null : null;
        this.post({ type: "current", id });
    }

    private cursor(): Cursor | undefined {
        const editor = this.editor;
        if (!editor || editor.document.isClosed || !this.root) return undefined;
        const file = pathIn(this.root, editor.document.uri);
        if (file === undefined) return undefined;
        const { line, character } = editor.selection.active;
        return { file, position: { line, character } };
    }

    private uriOf(file: string) {
        return vscode.Uri.joinPath(vscode.Uri.parse(this.root!), ...file.split("/"));
    }

    // In the column the story's being written in, rather than the map's
    private async goto(location: Location, focus: boolean) {
        if (!this.root) return;
        const { start, end } = location.range;
        const range = new vscode.Range(start.line, start.character, end.line, end.character);
        this.editor = await vscode.window.showTextDocument(this.uriOf(location.file), {
            viewColumn: this.editor?.viewColumn ?? vscode.ViewColumn.One,
            preserveFocus: !focus,
            selection: range,
        });
        this.editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    private async link(from: string, to: string) {
        await this.queue;
        if (!this.graph || !this.root) return;
        const result = linkEdit(this.graph, from, to, this.cursor());
        if ("error" in result) {
            void vscode.window.showInformationMessage(result.error);
            return;
        }
        const { start } = result.edit.range;
        const edit = new vscode.WorkspaceEdit();
        edit.insert(this.uriOf(result.file), new vscode.Position(start.line, start.character), result.edit.newText);
        if (!(await vscode.workspace.applyEdit(edit))) void vscode.window.showWarningMessage("Couldn't add the link.");
    }

    private move(moves: { id: string; at: { x: number; y: number } }[]) {
        this.queue = this.queue.then(async () => {
            if (!this.graph) return;
            this.positions = movedPositions(this.graph, this.positions, moves);
            await this.savePositions(this.positions);
        }).catch(e => void vscode.window.showWarningMessage(`Couldn't save the map: ${e instanceof Error ? e.message : e}`));
    }

    private async readPositions(): Promise<MapPositions | undefined> {
        if (!this.projectFile) return this.sessionPositions.get(this.root!);
        const parsed = parseProjectFile((await vscode.workspace.openTextDocument(this.projectFile)).getText());
        return parsed.success ? parsed.project.map : undefined;
    }

    // Into squiffy.json, as an edit (saved, unless it already had changes that weren't)
    private async savePositions(positions: MapPositions) {
        if (!this.projectFile) {
            this.sessionPositions.set(this.root!, positions);
            return;
        }
        const document = await vscode.workspace.openTextDocument(this.projectFile);
        const text = document.getText();
        const updated = updateProjectFile(text, { map: positions });
        if (updated === undefined) {
            void vscode.window.showWarningMessage("squiffy.json couldn't be read, so the map's positions weren't saved. Fix it, then try again.");
            return;
        }
        if (updated == text) return;
        const wasDirty = document.isDirty;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(this.projectFile, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), updated);
        if (await vscode.workspace.applyEdit(edit) && !wasDirty) await document.save();
    }

    dispose() {
        clearTimeout(this.updateTimer);
        this.panel?.dispose();
        for (const d of this.disposables) d.dispose();
    }
}

// A file's path in the story's folder, if it's in there
function pathIn(root: string, uri: vscode.Uri): string | undefined {
    const text = uri.toString();
    if (!text.startsWith(root)) return undefined;
    try {
        return text.substring(root.length).split("/").map(decodeURIComponent).join("/");
    }
    catch {
        return undefined;
    }
}

// The webview's page: the map's script and stylesheet, from the extension
export function mapHtml(cspSource: string, script: vscode.Uri, style: vscode.Uri) {
    const csp = [
        "default-src 'none'",
        `style-src ${cspSource} 'unsafe-inline'`,
        `script-src ${cspSource}`,
        `font-src ${cspSource}`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${style}">
<title>Story Map</title>
</head>
<body>
<script src="${script}"></script>
</body>
</html>`;
}

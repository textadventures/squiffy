// The story map (#615): the editor's map of the story, in a webview beside the text (the page is
// src/map/, bundled into dist/map/). Redrawn as you type, it follows the story of the active
// .squiffy editor, highlights the section the cursor is in, and goes to a section or passage when
// it's clicked. A link dragged from one box to another is added to the text as an edit, so Undo
// takes it out. Where boxes are dragged to is kept in squiffy.json, as the editor keeps it, or
// until the map's closed for a story without one.

import * as vscode from "vscode";
import type { BaseLanguageClient } from "vscode-languageclient";
import { parseProjectFile, updateProjectFile, type MapBoxSize, type MapPositions } from "squiffy-compiler";
import type { GraphNode, Location, StoryGraph, TextEdit } from "squiffy-compiler/language-service";
import { checkPassageName, deleteLinesEdits, deletionMessage, endingEdit, planDeletion, startEdit } from "@textadventures/squiffy-app/map-edits";
import { BOX_EXCERPT, checkSectionName, hasPositions, movedNodes, nodeAtLine, nodeExcerpt, nodeText, renamePositions, sectionKeys, withoutPositions, withPosition, withSize } from "@textadventures/squiffy-app/story-map";
import { STORY_GRAPH, type PreviewFromHereArgs, type StoryGraphParams, type StoryGraphResult } from "../protocol.js";
import type { FromMap, Point, ToMap, TraceStep } from "../map/messages.js";
import type { Preview } from "./preview.js";
import { addPassageEdits, linkEdit, linkEndsEnding, missingTarget, movedPositions, newPassageEdit, newSectionEdits, sectionFor, type Cursor } from "./map-edits.js";

// How long to wait after typing before drawing the map again
const UPDATE_DELAY = 300;

export class StoryMap implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    // A file in the story being shown
    private storyUri: vscode.Uri | undefined;
    // The story's folder, as a URI ending "/"
    private root: string | undefined;
    private projectFile: vscode.Uri | undefined;
    private mainFile: string | undefined;
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
    // Where the player has been in the preview, and the story's folder
    private trace: { root: string; steps: TraceStep[] } | undefined;
    // The map is searching, so it wants the sections' and passages' text with each graph (#679)
    private searching = false;

    constructor(private client: BaseLanguageClient, private extensionUri: vscode.Uri, preview: Preview) {
        this.disposables.push(
            preview.onDidStart(root => {
                this.trace = { root, steps: [] };
                this.sendTrace();
            }),
            preview.onDidVisit(({ root, section, passage }) => {
                if (this.trace?.root != root) this.trace = { root, steps: [] };
                // The last 500 places, as in the editor
                this.trace.steps = [...this.trace.steps.slice(-499), passage === undefined ? { section } : { section, passage }];
                this.sendTrace();
            }),
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

    // Shows the map, with the focus in its search box
    search() {
        if (!this.panel) return;
        this.panel.reveal(undefined, false);
        this.post({ type: "search" });
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
            case "resize":
                this.resize(message.id, message.size);
                break;
            case "rename":
                void this.act([message.id], "rename", ([node]) => this.rename(node));
                break;
            case "addPassage":
                void this.act([message.id], "add the passage", ([node]) => this.addPassage(node));
                break;
            case "run":
                void this.act([message.id], "run the preview", ([node]) => this.run(node));
                break;
            case "start":
                void this.act([message.id], "change where the story starts", ([node]) => this.startAt(node));
                break;
            case "ending":
                void this.act([message.id], "mark the ending", ([node]) => this.markEnding(node));
                break;
            case "delete":
                void this.act(message.ids, "delete", nodes => this.delete(nodes));
                break;
            case "create":
                void this.act([message.from, message.near].filter(id => id !== undefined), "add the section", nodes => {
                    const from = message.from ? nodes[0] : undefined;
                    return this.createSection(message.at, from, message.near ? nodes[nodes.length - 1] : undefined);
                });
                break;
            case "relayout":
                void this.relayout();
                break;
            case "excerpt":
                void this.sendExcerpt(message.request, message.id, message.long);
                break;
            case "searching":
                this.searching = message.on;
                if (message.on) this.queue = this.queue.then(() => this.sendTexts()).catch(e => console.error("Couldn't search the story map", e));
                break;
            case "createMissing":
                void this.act([message.edge.from], "add it", () => this.createMissing(message.edge, message.at));
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
        this.mainFile = result.mainFile;
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
        if (this.searching) await this.sendTexts();
        this.sendCurrent();
        if (!before) this.sendTrace();
    }

    // The text of every section and passage in the graph, for the map's search to find them by, as
    // in the editor. From the documents, so it's what's in an editor even before it's saved.
    private async sendTexts() {
        const graph = this.graph;
        if (!graph || !this.root) return;
        const byFile = new Map<string, GraphNode[]>();
        for (const node of graph.nodes) {
            // Not the master section, whose text is part of every section
            if (node.name === "") continue;
            const list = byFile.get(node.location.file);
            if (list) list.push(node);
            else byFile.set(node.location.file, [node]);
        }
        const texts: Record<string, string> = {};
        for (const [file, nodes] of byFile) {
            let lines: string[];
            try {
                lines = (await vscode.workspace.openTextDocument(this.uriOf(file))).getText().split(/\r?\n/);
            } catch {
                continue;
            }
            for (const node of nodes) texts[node.id] = nodeText(lines, node);
        }
        // Only for the graph it was read for
        if (this.graph === graph) this.post({ type: "texts", texts });
    }

    private async sendExcerpt(request: number, id: string, long?: boolean) {
        const node = this.graph?.nodes.find(n => n.id == id);
        let text = "";
        if (node && this.root) {
            try {
                text = nodeExcerpt((await vscode.workspace.openTextDocument(this.uriOf(node.location.file))).getText(), node, long ? BOX_EXCERPT : undefined);
            } catch {
                // No preview, then
            }
        }
        this.post({ type: "excerpt", request, text });
    }

    // The preview's trace, if it's of the story the map shows
    private sendTrace() {
        if (!this.root) return;
        this.post({ type: "trace", steps: this.trace?.root == this.root ? this.trace.steps : [] });
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
        return { file, position: { line, character }, lineText: editor.document.lineAt(line).text };
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
        const fromNode = this.graph.nodes.find(n => n.id == from)!;
        const text = (await vscode.workspace.openTextDocument(this.uriOf(result.file))).getText();
        const ending = fromNode.location.file == result.file ? linkEndsEnding(this.graph, fromNode, to, text) : [];
        try {
            await this.applyEdits(new Map([[result.file, [result.edit, ...ending]]]));
        } catch {
            void vscode.window.showWarningMessage("Couldn't add the link.");
        }
    }

    // Something from the map's menu, for the nodes it's for, once the graph's up to date
    private async act(ids: string[], what: string, run: (nodes: GraphNode[]) => Promise<void>) {
        await this.queue;
        const graph = this.graph;
        if (!graph || !this.root) return;
        const nodes = ids.flatMap(id => graph.nodes.find(n => n.id == id) ?? []);
        if (nodes.length < ids.length) {
            void vscode.window.showInformationMessage("The story has changed. Try again.");
            return;
        }
        try {
            await run(nodes);
        } catch (e) {
            void vscode.window.showWarningMessage(`Couldn't ${what}: ${e instanceof Error ? e.message : e}`);
        }
    }

    // As F2 in the script does, with the language server's rename
    private async rename(node: GraphNode) {
        if (node.detail) return;
        const name = await vscode.window.showInputBox({
            // The map takes the focus back as the click or drag that asked for it ends
            ignoreFocusOut: true,
            title: `Rename the ${node.kind} "${node.name}"`,
            prompt: "Links to it are changed too.",
            value: node.name,
            validateInput: value => value.trim() ? undefined : "A name can't be empty.",
        });
        if (name === undefined || name.trim() == node.name) return;
        const { start } = node.location.range;
        const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit | undefined>("vscode.executeDocumentRenameProvider",
            this.uriOf(node.location.file), new vscode.Position(start.line, start.character), name.trim());
        if (edit) await vscode.workspace.applyEdit(edit);
    }

    // A passage at the end of the section, with a link to it from the box the menu was for
    private async addPassage(node: GraphNode) {
        const graph = this.graph!;
        const section = sectionFor(graph, node);
        if (!section) return;
        const name = await vscode.window.showInputBox({
            // The map takes the focus back as the click or drag that asked for it ends
            ignoreFocusOut: true,
            title: `Add a passage to the section "${section.name}"`,
            prompt: node.kind == "passage" ? `With a link to it from the passage "${node.name}".` : "With a link to it from the section.",
            validateInput: value => checkPassageName(value, section.name, graph),
        });
        if (name === undefined) return;
        const uri = this.uriOf(section.location.file);
        const text = (await vscode.workspace.openTextDocument(uri)).getText();
        const result = addPassageEdits(graph, node, name, text, this.cursor());
        if (!result) return;
        await this.applyEdits(new Map([[result.file, result.edits]]));
    }

    private async run(node: GraphNode) {
        const startAt = node.kind == "section" ? { section: node.name } : { section: node.section!, passage: node.name };
        const args: PreviewFromHereArgs = [this.uriOf(node.location.file).toString(), startAt];
        await vscode.commands.executeCommand("squiffy.previewFromHere", ...args);
    }

    // With @start in the main file
    private async startAt(node: GraphNode) {
        if (node.kind != "section" || node.start || node.detail || !node.name || !this.mainFile) return;
        const text = (await vscode.workspace.openTextDocument(this.uriOf(this.mainFile))).getText();
        await this.applyEdits(new Map([[this.mainFile, [startEdit(text, node.name)]]]));
    }

    // With @end under the section's header
    private async markEnding(node: GraphNode) {
        if (node.kind != "section" || !node.deadEnd) return;
        const file = node.location.file;
        const text = (await vscode.workspace.openTextDocument(this.uriOf(file))).getText();
        await this.applyEdits(new Map([[file, [endingEdit(text, node)]]]));
    }

    // A new section, after asking its name: linked from `from` (a link dragged to empty space), or
    // after `near` in the script. Its box goes where it was made.
    private async createSection(at: Point, from: GraphNode | undefined, near: GraphNode | undefined) {
        const graph = this.graph!;
        const name = await vscode.window.showInputBox({
            // The map takes the focus back as the click or drag that asked for it ends
            ignoreFocusOut: true,
            title: from ? `Add a section, with a link to it from ${describe(from)}` : "Add a section",
            prompt: "Its name",
            validateInput: value => checkSectionName(value, graph),
        });
        if (name === undefined) return;
        // In the file of what it's linked from or near, or the script being written in
        const cursor = this.cursor();
        const file = from?.location.file ?? near?.location.file ?? (cursor?.file.endsWith(".squiffy") ? cursor.file : this.mainFile!);
        const text = (await vscode.workspace.openTextDocument(this.uriOf(file))).getText();
        const ending = from && from.location.file == file ? linkEndsEnding(graph, from, undefined, text) : [];
        await this.applyEdits(new Map([[file, [...newSectionEdits(graph, name, { from, near, file }, text, cursor), ...ending]]]));
        this.placeNew({ kind: "section", name }, at);
    }

    // What a broken link is missing: the section or passage it names
    private async createMissing(edge: { from: string; kind: string; target?: string }, at: Point | undefined) {
        const graph = this.graph!;
        const target = missingTarget(graph, edge);
        if (!target) {
            void vscode.window.showInformationMessage("This can't be added from the map. Change it in the script.");
            return;
        }
        const { kind, name, from } = target;
        if (kind == "passage") {
            const section = sectionFor(graph, from);
            const problem = section ? checkPassageName(name, section.name, graph) : "The story has changed. Try again.";
            if (problem || !section) {
                void vscode.window.showInformationMessage(problem!);
                return;
            }
            const { file, edit } = newPassageEdit(section, name, (await vscode.workspace.openTextDocument(this.uriOf(section.location.file))).getText());
            await this.applyEdits(new Map([[file, [edit]]]));
            this.placeNew({ kind: "passage", name, section: section.name }, at);
            return;
        }
        const problem = checkSectionName(name, graph);
        if (problem) {
            void vscode.window.showInformationMessage(problem);
            return;
        }
        const file = from.location.file;
        const text = (await vscode.workspace.openTextDocument(this.uriOf(file))).getText();
        await this.applyEdits(new Map([[file, newSectionEdits(graph, name, { from, link: false, file }, text)]]));
        this.placeNew({ kind: "section", name }, at);
    }

    // Lay out again: forgets where boxes have been put, after asking, as the editor does
    private async relayout() {
        await this.queue;
        const saved = hasPositions(this.positions);
        if (saved) {
            const answer = await vscode.window.showWarningMessage("Lay out the map again?", { modal: true, detail: "Everything you've moved by hand goes back to where the map puts it." }, "Lay out again");
            if (answer != "Lay out again") return;
        }
        this.post({ type: "relayout" });
        if (!saved) return;
        this.queue = this.queue.then(async () => {
            this.positions = withoutPositions(this.positions);
            await this.savePositions(this.positions);
        }).catch(e => void vscode.window.showWarningMessage(`Couldn't save the map: ${e instanceof Error ? e.message : e}`));
    }

    // A section or passage just made from the map: its box goes where it was made, and it's selected
    // once the map has it
    private placeNew(node: { kind: "section" | "passage"; name: string; section?: string }, at: Point | undefined) {
        this.post({ type: "select", id: node.kind == "section" ? `section:${node.name}` : `passage:${node.section}/${node.name}` });
        if (!at) return;
        this.queue = this.queue.then(async () => {
            this.positions = withPosition(this.positions, new Map(), node, at);
            await this.savePositions(this.positions);
        }).catch(e => void vscode.window.showWarningMessage(`Couldn't save the map: ${e instanceof Error ? e.message : e}`));
    }

    // After asking, as the editor's map does
    private async delete(nodes: GraphNode[]) {
        const graph = this.graph!;
        // The text of every file with links in it, to find the links on lines of their own, and
        // of the main file, for its @start line
        const texts = new Map<string, string>();
        const files = new Set(graph.edges.map(e => e.location.file));
        if (this.mainFile) files.add(this.mainFile);
        for (const file of files) {
            texts.set(file, (await vscode.workspace.openTextDocument(this.uriOf(file))).getText());
        }
        const plan = planDeletion(graph, nodes, texts, this.mainFile);
        if (!plan) return;
        const answer = await vscode.window.showWarningMessage(deletionMessage(plan), { modal: true }, "Delete");
        if (answer != "Delete" || this.graph != graph) return;
        const edits = new Map<string, TextEdit[]>();
        for (const [file, ranges] of plan.ranges) {
            edits.set(file, deleteLinesEdits((await vscode.workspace.openTextDocument(this.uriOf(file))).getText(), ranges));
        }
        await this.applyEdits(edits);
    }

    // Edits to the story's files (by their paths), as one change, so one Undo takes it all out
    private async applyEdits(edits: Map<string, TextEdit[]>) {
        const edit = new vscode.WorkspaceEdit();
        for (const [file, list] of edits) {
            edit.set(this.uriOf(file), list.map(e => new vscode.TextEdit(
                new vscode.Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character), e.newText)));
        }
        if (!(await vscode.workspace.applyEdit(edit))) throw new Error("VS Code didn't make the change.");
    }

    private move(moves: { id: string; at: { x: number; y: number } }[]) {
        this.queue = this.queue.then(async () => {
            if (!this.graph) return;
            this.positions = movedPositions(this.graph, this.positions, moves);
            await this.savePositions(this.positions);
        }).catch(e => void vscode.window.showWarningMessage(`Couldn't save the map: ${e instanceof Error ? e.message : e}`));
    }

    // A box made bigger, or the usual size again
    private resize(id: string, size: MapBoxSize | undefined) {
        this.queue = this.queue.then(async () => {
            const node = this.graph?.nodes.find(n => n.id == id);
            if (!node || !this.graph) return;
            this.positions = withSize(this.positions, sectionKeys(this.graph), node, size);
            // The map draws sizes from the positions, which otherwise only come with a new graph
            this.post({ type: "positions", positions: this.positions });
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

// A section or passage, as a message names it
function describe(node: GraphNode) {
    if (node.kind == "passage") return `the passage "${node.name}"`;
    return node.name ? `the section "${node.name}"` : "the story's opening";
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

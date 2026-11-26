// The Squiffy sidebar's Sections view (#616): every section and passage in the story, across all
// its files, marked as the story map marks them (sections.ts). It follows the story of the active
// .squiffy editor (or squiffy.json), or before one's opened, the first story in the workspace, and
// is updated as you type. Clicking an item goes to it, and its inline button starts the preview
// there. As the cursor moves, the section it's in is selected, as the Outline does.
// With no story in the workspace, the view's welcome content (package.json) offers to make one.

import * as vscode from "vscode";
import type { BaseLanguageClient } from "vscode-languageclient";
import { nodeAtLine } from "@textadventures/squiffy-app/story-map";
import type { StoryGraph } from "squiffy-compiler/language-service";
import { STORY_GRAPH, type StoryGraphParams, type StoryGraphResult } from "../protocol.js";
import { findProjectFiles, isProjectFile } from "./files.js";
import { setHasStory } from "./has-story.js";
import { parentsOf, sectionsTree, type Mark, type NodeItem, type SectionsItem } from "./sections.js";

// How long to wait after typing before updating the view
const UPDATE_DELAY = 300;

const ICONS: Record<Mark, vscode.ThemeIcon> = {
    "dead-end": new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground")),
    unreachable: new vscode.ThemeIcon("circle-slash", new vscode.ThemeColor("disabledForeground")),
    start: new vscode.ThemeIcon("debug-start", new vscode.ThemeColor("charts.green")),
    ending: new vscode.ThemeIcon("pass", new vscode.ThemeColor("charts.blue")),
    test: new vscode.ThemeIcon("beaker"),
    embedded: new vscode.ThemeIcon("symbol-snippet"),
};

export class SectionsView implements vscode.TreeDataProvider<SectionsItem>, vscode.Disposable {
    private view: vscode.TreeView<SectionsItem>;
    private changed = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.changed.event;
    // A file in the story being shown
    storyUri: vscode.Uri | undefined;
    // The story's folder, as a URI ending "/"
    private root: string | undefined;
    // The story's main file, as a path from root
    mainFile: string | undefined;
    private graph: StoryGraph | undefined;
    private items: SectionsItem[] = [];
    private parents = new Map<string, SectionsItem>();
    private byId = new Map<string, NodeItem>();
    // Whether the view needs updating when it's next shown
    private stale = true;
    private updateTimer: ReturnType<typeof setTimeout> | undefined;
    private queue: Promise<void> = Promise.resolve();
    private disposables: vscode.Disposable[] = [];

    constructor(private client: BaseLanguageClient) {
        this.view = vscode.window.createTreeView("squiffy.sections", { treeDataProvider: this, showCollapseAll: true });
        this.disposables.push(
            this.view,
            this.changed,
            this.view.onDidChangeVisibility(({ visible }) => {
                if (visible && this.stale) this.update();
            }),
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (!editor || !isStoryEditor(editor)) return;
                if (this.isInStory(editor.document.uri)) {
                    this.revealCursor(editor);
                    return;
                }
                // Another story's file: show that story instead
                this.storyUri = editor.document.uri;
                this.root = undefined;
                this.update();
            }),
            vscode.window.onDidChangeTextEditorSelection(e => {
                if (e.textEditor.document.languageId == "squiffy" && this.isInStory(e.textEditor.document.uri)) this.revealCursor(e.textEditor);
            }),
            vscode.workspace.onDidChangeTextDocument(e => {
                if (e.contentChanges.length && this.isInStory(e.document.uri)) this.scheduleUpdate();
            }),
        );
        // Files changed outside the editor, added or deleted. A new .squiffy file or squiffy.json
        // may be a story where there wasn't one.
        const watcher = vscode.workspace.createFileSystemWatcher("**/*.{squiffy,json}");
        const fileChanged = (uri: vscode.Uri) => {
            if (!this.storyUri || this.isInStory(uri)) this.scheduleUpdate();
        };
        this.disposables.push(watcher, watcher.onDidChange(fileChanged), watcher.onDidCreate(fileChanged), watcher.onDidDelete(fileChanged));
        const editor = vscode.window.activeTextEditor;
        if (editor && isStoryEditor(editor)) this.storyUri = editor.document.uri;
        this.update();
        // The view only looks for a story while it can be seen
        void findStory().then(story => story && setHasStory());
    }

    private isInStory(uri: vscode.Uri) {
        return !!this.root && uri.toString().startsWith(this.root);
    }

    getTreeItem(item: SectionsItem): vscode.TreeItem {
        if (item.kind == "file") {
            const tree = new vscode.TreeItem(this.uriOf(item.file), vscode.TreeItemCollapsibleState.Expanded);
            tree.id = item.id;
            tree.label = item.file;
            tree.contextValue = "file";
            return tree;
        }
        const tree = new vscode.TreeItem(item.label, item.children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        tree.id = item.id;
        tree.description = item.description;
        tree.tooltip = item.tooltip;
        tree.iconPath = item.marks.length ? ICONS[item.marks[0]] : new vscode.ThemeIcon(item.kind == "section" ? "symbol-class" : "symbol-method");
        tree.contextValue = item.master ? "master" : item.kind;
        const { file, range } = item.node.location;
        tree.command = {
            title: "Go to",
            command: "vscode.open",
            arguments: [this.uriOf(file), {
                selection: new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character),
                preserveFocus: true,
            } satisfies vscode.TextDocumentShowOptions],
        };
        return tree;
    }

    getChildren(item?: SectionsItem): SectionsItem[] {
        return item ? item.children : this.items;
    }

    getParent(item: SectionsItem): SectionsItem | undefined {
        return this.parents.get(item.id);
    }

    // The file an item is in, to start the preview from
    fileOf(item: NodeItem) {
        return this.uriOf(item.node.location.file);
    }

    // The story's main file
    mainFileUri() {
        return this.root && this.mainFile !== undefined ? this.uriOf(this.mainFile) : undefined;
    }

    private uriOf(file: string) {
        return vscode.Uri.joinPath(vscode.Uri.parse(this.root!), ...file.split("/"));
    }

    private scheduleUpdate() {
        clearTimeout(this.updateTimer);
        this.updateTimer = setTimeout(() => this.update(), UPDATE_DELAY);
    }

    private update() {
        clearTimeout(this.updateTimer);
        // Only while it can be seen. It's updated when it's next shown.
        if (!this.view.visible) {
            this.stale = true;
            return;
        }
        this.stale = false;
        this.queue = this.queue.then(() => this.refresh()).catch(e => console.error("Couldn't update the Sections view", e));
    }

    private async refresh() {
        this.storyUri ??= await findStory();
        let result: StoryGraphResult | undefined;
        if (this.storyUri) {
            try {
                result = await this.client.sendRequest<StoryGraphResult>(STORY_GRAPH, { uri: this.storyUri.toString() } satisfies StoryGraphParams);
            }
            catch {
                // The file's gone, say: look for a story again next time
                this.storyUri = undefined;
            }
        }
        this.root = result?.root;
        this.mainFile = result?.mainFile;
        this.graph = result?.graph;
        this.items = result ? sectionsTree(result.graph, result.mainFile) : [];
        this.parents = parentsOf(this.items);
        this.byId = new Map();
        const index = (item: SectionsItem) => {
            if (item.kind != "file") this.byId.set(item.id, item);
            item.children.forEach(index);
        };
        this.items.forEach(index);
        // Which buttons the view has, and whether it shows its welcome content
        void vscode.commands.executeCommand("setContext", "squiffyNoStory", !result);
        if (result) setHasStory();
        this.changed.fire();
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.languageId == "squiffy" && this.isInStory(editor.document.uri)) this.revealCursor(editor);
    }

    // Selects the section or passage the cursor's in, without taking the focus from the editor
    private revealCursor(editor: vscode.TextEditor) {
        if (!this.view.visible || !this.graph || !this.root) return;
        const file = editor.document.uri.toString().slice(this.root.length);
        const node = nodeAtLine(this.graph, decodeURIComponent(file), editor.selection.active.line);
        const item = node && this.byId.get(node.id);
        if (!item || this.view.selection[0]?.id == item.id) return;
        void this.view.reveal(item, { select: true, focus: false });
    }

    dispose() {
        clearTimeout(this.updateTimer);
        this.disposables.forEach(d => d.dispose());
    }
}

const isStoryEditor = (editor: vscode.TextEditor) => editor.document.languageId == "squiffy" || isProjectFile(editor.document.uri);

// The first story in the workspace, before a file in one is opened: a squiffy.json, or a .squiffy file
export async function findStory(): Promise<vscode.Uri | undefined> {
    const [project] = await findProjectFiles();
    if (project) return vscode.Uri.parse(project);
    const [file] = await vscode.workspace.findFiles("**/*.squiffy", "**/{node_modules,.*}/**", 1);
    return file;
}

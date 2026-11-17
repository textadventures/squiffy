<script lang="ts">
    // The editor: toolbar; files and outline; a tab and a code editor for each open file; and the
    // preview. Laid out like Quest Viva's edit page.
    import { onMount, tick, untrack } from "svelte";
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { EditorView } from "@codemirror/view";
    import type { Extension } from "@codemirror/state";
    import type { DocumentSymbol, GraphNode, Location, StoryGraph, WorkspaceEdit } from "squiffy-compiler/language-service";
    import type { MapPositions } from "squiffy-compiler";
    import { basename, dirname, extname, guessMimeType, joinPath, parsePath } from "@textadventures/project-fs";
    import { base } from "#lib/base-path.js";
    import { project, openDraft, openRecentFolder, downloadFile, storyPath, offerProjectFile, type ProjectOffer } from "#lib/project.svelte.js";
    import { isAsset, isSquiffyFile, isTextFile } from "#lib/file-types.js";
    import { createLanguageClient, type LanguageClient } from "#lib/language/client.js";
    import { applyEditsToString, applyTextEdits, languageFeatures, recheckProblems, toOffset, toPosition } from "#lib/language/codemirror.js";
    import { squiffyLanguage } from "@textadventures/squiffy-codemirror";
    import { css } from "@codemirror/lang-css";
    import { javascript } from "@codemirror/lang-javascript";
    import { isNarrow } from "#lib/layout.svelte.js";
    import { showToast } from "#lib/toast.js";
    import { chooseDialog, confirmDialog, promptDialog } from "#lib/confirm.js";
    import Toolbar from "#components/Toolbar.svelte";
    import FilesPanel from "#components/FilesPanel.svelte";
    import OutlinePanel from "#components/OutlinePanel.svelte";
    import EditorTabs from "#components/EditorTabs.svelte";
    import CodeEditor from "#components/CodeEditor.svelte";
    import ReferencesPanel from "#components/ReferencesPanel.svelte";
    import PreviewPanel from "#components/PreviewPanel.svelte";
    import MapPanel, { type TraceStep } from "#components/MapPanel.svelte";
    import { checkSectionName, findRenames, linkTo, nodeAtLine, renamePositions, withPosition, type Point, type StoryMapEdge, type StoryMapNode } from "#lib/story-map.js";
    import AssetManagerModal from "#components/AssetManagerModal.svelte";
    import AboutModal from "#components/AboutModal.svelte";
    import { addSectionOrPassage, insertSnippet, runCommand, userSnippets } from "#lib/editor-commands.js";
    import type { ExportKind } from "#lib/language/protocol.js";

    const p = $derived(project.current);

    let loading = $state(true);
    // Each open .squiffy file's outline, from its last analysis
    let symbolsByPath = $state<Record<string, DocumentSymbol[]>>({});
    let cursorLine = $state(0);
    // The editor for each open file
    const views = new Map<string, EditorView>();
    let outline = $state<ReturnType<typeof OutlinePanel>>();
    // Shift+F12's results, shown under the editor
    let references = $state<{ name: string; locations: Location[] } | null>(null);
    let assetsOpen = $state(false);
    let aboutOpen = $state(false);
    // Changes whenever an asset is added, changed or deleted, so the preview gets it
    let assetsVersion = $state(0);

    let preview = $state<ReturnType<typeof PreviewPanel>>();
    let previewOpen = $state(false);

    // The story map (#380)
    let mapPanel = $state<ReturnType<typeof MapPanel>>();
    let mapOpen = $state(false);
    let mapMaximized = $state(false);
    // Raw, as it's replaced rather than changed, and can be large
    let storyGraph = $state.raw<StoryGraph | null>(null);
    // Bumped when a file changes in the project, to read the graph again
    let filesVersion = $state(0);
    // The outline's search, which filters the map too
    let outlineQuery = $state("");
    // Where the player's been in the preview since it last started
    let trace = $state.raw<TraceStep[]>([]);
    // Without a squiffy.json, positions on the map last as long as the editor's open
    let sessionPositions = $state.raw<MapPositions | undefined>();

    // Session-only, as in Quest Viva
    let sidebarWidth = $state(240);
    let previewWidth = $state(420);
    let mapWidth = $state(480);
    const SIDEBAR_LIMITS = [160, 500] as const;
    const PREVIEW_LIMITS = [280, 900] as const;
    const MAP_LIMITS = [280, 1400] as const;

    // On a narrow screen one pane shows at a time: the editor, the sidebar or the preview
    let narrowPane = $state<"editor" | "outline" | "preview" | "map">("editor");

    const activeView = () => (p ? views.get(p.activePath) : undefined);
    let symbols = $derived(p ? symbolsByPath[p.activePath] ?? [] : []);
    // The author's own snippets, in the open files
    let snippets = $derived(p ? p.openFiles.flatMap(f => userSnippets(symbolsByPath[f.path] ?? [], f.text)) : []);

    onMount(() => {
        void (async () => {
            const draftId = page.url.searchParams.get("draft");
            const folderId = page.url.searchParams.get("folder");
            const current = project.current;
            const isOpen = current !== null && current.source.id === (draftId ?? folderId);
            try {
                if (draftId && !isOpen) await openDraft(draftId);
                // After a reload: only if the browser still lets us use the folder, since asking
                // again needs a click. Otherwise it's on the home page's Recent folders.
                if (folderId && !isOpen && !(await openRecentFolder(folderId, false))) {
                    showToast("Open the folder again from Recent folders.", "info");
                }
            } catch (err) {
                showToast(`Couldn't open the story: ${err instanceof Error ? err.message : String(err)}`);
            }
            if (!project.current) {
                void goto(`${base}/`, { replaceState: true });
                return;
            }
            loading = false;
        })();

        function handleVisibilityChange() {
            if (document.hidden) void project.current?.save();
        }
        // Ctrl/Cmd+Shift+O: go to a section or passage, from the outline's search box.
        // Ctrl/Cmd+Enter: run the story; with Shift, from the section the cursor is in. Caught
        // before the editor sees them, since Ctrl/Cmd+Enter would otherwise add a line.
        function handleKeydown(e: KeyboardEvent) {
            if (!(e.metaKey || e.ctrlKey)) return;
            if (e.shiftKey && e.key.toLowerCase() === "o") {
                e.preventDefault();
                // At once when the outline's showing, so the next keys go to the search box; on a
                // phone, once the outline has replaced the editor
                if (outline) outline.focusSearch();
                else {
                    narrowPane = "outline";
                    void tick().then(() => outline?.focusSearch());
                }
            } else if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                void runPreview(e.shiftKey);
            }
        }
        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("keydown", handleKeydown, true);
        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("keydown", handleKeydown, true);
        };
    });

    // Best effort to save before the tab closes. A write can't be awaited here, so the browser's
    // "leave site?" prompt is the safety net while there are unsaved changes.
    $effect(() => {
        if (!p?.dirty) return;
        function handleBeforeUnload(e: BeforeUnloadEvent) {
            void p?.save();
            e.preventDefault();
        }
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    });

    // One language service worker per open project
    let client = $state<LanguageClient | null>(null);

    $effect(() => {
        const current = p;
        if (!current) return;
        const fs = current.fs;
        const c = createLanguageClient({
            list: () => fs.list(),
            readText: path => fs.readText(path),
        });
        void c.call("open", current.mainFile);
        current.onFileChanged = path => {
            // Another file's change (such as squiffy.json leaving a file out of the story) can
            // change the problems in the files that are open, so check them again
            void c.call("fileChanged", path).then(() => {
                for (const [open, view] of views) {
                    if (open !== path && isSquiffyFile(open)) recheckProblems(view);
                }
            });
            if (isAsset(path)) assetsVersion++;
            filesVersion++;
        };
        client = c;
        return () => {
            current.onFileChanged = undefined;
            c.dispose();
            client = null;
        };
    });

    // Making another file the main one starts the analysis from there
    $effect(() => {
        const main = p?.mainFile;
        if (client && main) void client.call("setMainFile", main);
    });

    // A closed file goes back to being read from the project
    let openPaths: string[] = [];
    $effect(() => {
        const now = p?.openFiles.map(f => f.path) ?? [];
        for (const path of openPaths) {
            if (!now.includes(path)) {
                if (isSquiffyFile(path)) void client?.call("updateFile", path, undefined);
                views.delete(path);
            }
        }
        openPaths = now;
    });

    // Each file's extensions, made once per file and language service, so the editor isn't
    // reconfigured on every change
    let extensionCache = new Map<string, Extension[]>();
    $effect(() => {
        void client;
        extensionCache = new Map();
    });

    // Other files the editor highlights, by extension. These don't depend on the file or the
    // language service, so one set of extensions does for every file of that kind.
    const otherLanguages: Record<string, () => Extension[]> = {
        ".css": () => [css()],
        ".js": () => [javascript()],
        ".mjs": () => [javascript()],
    };
    const otherLanguageCache = new Map<string, Extension[]>();

    function otherLanguageFor(path: string): Extension[] {
        const ext = extname(path).toLowerCase();
        const make = otherLanguages[ext];
        if (!make) return [];
        let extensions = otherLanguageCache.get(ext);
        if (!extensions) {
            extensions = make();
            otherLanguageCache.set(ext, extensions);
        }
        return extensions;
    }

    function extensionsFor(path: string): Extension[] {
        if (!isSquiffyFile(path)) return otherLanguageFor(path);
        const c = client;
        const current = p;
        if (!c || !current) return [];
        let extensions = extensionCache.get(path);
        if (!extensions) {
            extensions = [
                squiffyLanguage,
                languageFeatures({
                    client: c,
                    path,
                    onSymbols: s => {
                        symbolsByPath = { ...symbolsByPath, [path]: s };
                        if (path === current.mainFile) current.setTitle(s.find(x => x.kind === "title")?.name ?? "");
                    },
                    onNavigate: goToLocation,
                    onReferences: (name, locations) => {
                        references = { name, locations };
                    },
                    prompt: (message, initial) => promptDialog(message, initial, "Rename"),
                    applyEdits,
                    notify: message => showToast(message, "info"),
                }),
            ];
            extensionCache.set(path, extensions);
        }
        return extensions;
    }

    // Waits for an open file's editor to be on screen
    async function viewFor(path: string): Promise<EditorView | undefined> {
        await tick();
        await new Promise(requestAnimationFrame);
        return views.get(path);
    }

    // Moves the editor to a location, opening its file if need be
    async function goToLocation(location: Location) {
        if (!p) return;
        narrowPane = "editor";
        try {
            await p.open(location.file);
        } catch (err) {
            showToast(`Couldn't open ${location.file}: ${errorText(err)}`);
            return;
        }
        const view = await viewFor(location.file);
        if (!view) return;
        const anchor = toOffset(view.state.doc, location.range.start);
        const head = toOffset(view.state.doc, location.range.end);
        view.dispatch({ selection: { anchor, head }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
        view.focus();
    }

    // Edits to other files, e.g. a rename that reaches into an @imported file. An open file is
    // changed in its editor, so it's one step to undo there; others are changed on disk.
    async function applyEdits(edit: WorkspaceEdit) {
        if (!p || !client) return;
        for (const [file, edits] of Object.entries(edit)) {
            const view = views.get(file);
            if (view) {
                applyTextEdits(view, edits);
                continue;
            }
            try {
                await p.fs.write(file, applyEditsToString(await p.fs.readText(file), edits));
                await client.call("fileChanged", file);
            } catch (err) {
                showToast(`Couldn't change ${file}: ${errorText(err)}`);
            }
        }
    }

    // Sends the language service the text of every open .squiffy file, which may not be saved yet
    async function syncOpenFiles() {
        const current = p;
        const c = client;
        if (!current || !c) return;
        await Promise.all(current.openFiles.filter(f => isSquiffyFile(f.path)).map(f => c.call("updateFile", f.path, f.text)));
    }

    // Compiles the story as it is in the editor now, for the preview
    async function compileStory() {
        if (!client) return { success: false as const, errors: ["The story isn't open."] };
        await syncOpenFiles();
        return client.call("compile");
    }

    // The story's assets for the preview, by their path from the main file's folder
    async function previewAssets(): Promise<Record<string, Blob>> {
        const current = p;
        if (!current) return {};
        // One that's gone since the list was made (e.g. deleted from outside the app) is left out
        const entries = await Promise.all(current.files.filter(f => isAsset(f.path)).map(async f => {
            try {
                const data = await current.fs.read(f.path);
                return [[storyPath(current, f.path), new Blob([data as BlobPart], { type: guessMimeType(f.path) })] as const];
            } catch {
                return [];
            }
        }));
        return Object.fromEntries(entries.flat());
    }

    // Runs the story in the preview: from the start, or from the section (and passage) the
    // cursor is in (#175)
    async function runPreview(fromCursor = false, at?: { section: string; passage?: string }) {
        if (!p || !client) return;
        let startAt = at;
        const view = activeView();
        if (!at && fromCursor && view && isSquiffyFile(p.activePath)) {
            await syncOpenFiles();
            startAt = await client.call("getSectionAt", p.activePath, toPosition(view.state.doc, view.state.selection.main.head));
        }
        previewOpen = true;
        narrowPane = "preview";
        await tick();
        await preview?.run(startAt);
    }

    // Edits hot-update the running story, once typing pauses
    $effect(() => {
        void p?.openFiles.map(f => f.text);
        if (!previewOpen) return;
        const timer = setTimeout(() => void preview?.update(), 600);
        return () => clearTimeout(timer);
    });

    // When the player clicks through to a section or passage, the editor follows, opening its
    // file if need be, without taking the focus from the preview
    async function followPreview(section: string, passage?: string) {
        if (!p || !client) return;
        const location = await client.call("findSection", section, passage);
        if (!location) return;
        await p.open(location.file);
        const view = await viewFor(location.file);
        if (!view) return;
        const offset = toOffset(view.state.doc, location.range.start);
        view.dispatch({ selection: { anchor: offset }, effects: EditorView.scrollIntoView(offset, { y: "start", yMargin: 24 }) });
    }

    function goToSymbol(symbol: DocumentSymbol) {
        narrowPane = "editor";
        // On a narrow screen the editor is only now coming back, so wait for it
        requestAnimationFrame(() => {
            const view = activeView();
            if (!view) return;
            const offset = toOffset(view.state.doc, symbol.selectionRange.start);
            view.dispatch({
                selection: { anchor: offset },
                effects: EditorView.scrollIntoView(offset, { y: "start", yMargin: 24 }),
            });
            view.focus();
        });
    }

    function handleCursor(path: string, offset: number) {
        const view = views.get(path);
        if (view && path === p?.activePath) cursorLine = view.state.doc.lineAt(offset).number - 1;
    }

    // ---- The story map ----

    const mapPositions = $derived(p?.projectFile ? p.projectFile.map : sessionPositions);

    // The section or passage the cursor's in, which the map highlights
    let currentNode = $derived(storyGraph && p && isSquiffyFile(p.activePath) ? nodeAtLine(storyGraph, p.activePath, cursorLine)?.id ?? null : null);

    // Read the graph again as the story changes, once typing pauses
    let graphRequest = 0;
    $effect(() => {
        void p?.openFiles.map(f => f.text);
        void filesVersion;
        if (!mapOpen || !client) return;
        // Untracked, or reading the graph would read it again whenever it arrives
        const timer = setTimeout(() => void refreshGraph(), untrack(() => storyGraph) ? 400 : 0);
        return () => clearTimeout(timer);
    });

    // A node to select once it's on the map, e.g. a section just added from it
    let selectWhenReady: string | null = null;

    async function refreshGraph() {
        const c = client;
        if (!c) return;
        const request = ++graphRequest;
        await syncOpenFiles();
        const graph = await c.call("getStoryGraph");
        if (request !== graphRequest) return;
        const before = storyGraph;
        if (before) {
            // Renamed sections and passages keep their places
            const renames = findRenames(before, graph);
            for (const [from, to] of renames) mapPanel?.rename(from.id, to.id);
            const moved = renamePositions(mapPositions, renames);
            if (moved) void savePositions(moved);
        }
        storyGraph = graph;
        if (selectWhenReady && graph.nodes.some(n => n.id === selectWhenReady)) {
            const id = selectWhenReady;
            selectWhenReady = null;
            await tick();
            mapPanel?.focusNode(id);
        }
    }

    function toggleMap() {
        if (mapOpen && (!isNarrow.current || narrowPane === "map")) {
            mapOpen = false;
            mapMaximized = false;
            narrowPane = "editor";
        } else {
            mapOpen = true;
            narrowPane = "map";
        }
    }

    // Saving positions one at a time, so a quick second drag doesn't race the first
    let positionsQueue: Promise<unknown> = Promise.resolve();
    let warnedNoProjectFile = false;
    function savePositions(next: MapPositions) {
        const current = p;
        if (!current) return;
        if (!current.projectFile) {
            sessionPositions = next;
            if (!warnedNoProjectFile) {
                warnedNoProjectFile = true;
                showToast("Where you put things on the map is saved in squiffy.json, which this story doesn't have, so it'll be forgotten when you close it.", "info", 8000);
            }
            return;
        }
        positionsQueue = positionsQueue.then(async () => {
            try {
                if (!(await current.setMapPositions(next))) showToast("squiffy.json couldn't be read, so the map's positions weren't saved. Fix it, then try again.");
            } catch (err) {
                showToast(`Couldn't save the map: ${errorText(err)}`);
            }
        });
    }

    // Shows a location in the editor, opening its file, without taking the focus from the map
    async function showLocation(location: Location) {
        if (!p) return;
        try {
            await p.open(location.file);
        } catch (err) {
            showToast(`Couldn't open ${location.file}: ${errorText(err)}`);
            return;
        }
        const view = await viewFor(location.file);
        if (!view) return;
        const offset = toOffset(view.state.doc, location.range.start);
        view.dispatch({ selection: { anchor: offset }, effects: EditorView.scrollIntoView(offset, { y: "start", yMargin: 24 }) });
    }

    function goFromMap(location: Location, focus: boolean) {
        if (focus || mapMaximized || isNarrow.current) {
            mapMaximized = false;
            void goToLocation(location);
        } else {
            void showLocation(location);
        }
    }

    // Where a new link from a section or passage goes: at the cursor, if it's in there, or else
    // after the last thing in it
    function linkEdit(from: GraphNode, text: string): WorkspaceEdit {
        const file = from.location.file;
        const view = views.get(file);
        if (view && p?.activePath === file && storyGraph) {
            const head = view.state.selection.main.head;
            const at = toPosition(view.state.doc, head);
            if (nodeAtLine(storyGraph, file, at.line)?.id === from.id && at.line > from.location.range.start.line) {
                return { [file]: [{ range: { start: at, end: at }, newText: text }] };
            }
        }
        const at = from.contentEnd;
        const headerOnly = at.line === from.location.range.start.line;
        return { [file]: [{ range: { start: at, end: at }, newText: `${headerOnly ? "\n" : "\n\n"}${text}` }] };
    }

    // A new section at the end of a file
    async function newSectionEdit(file: string, name: string): Promise<WorkspaceEdit> {
        const text = p?.fileAt(file)?.text ?? await p!.fs.readText(file);
        const lines = text.split("\n");
        const end = { line: lines.length - 1, character: lines[lines.length - 1].length };
        const gap = text.endsWith("\n\n") || text === "" ? "" : text.endsWith("\n") ? "\n" : "\n\n";
        return { [file]: [{ range: { start: end, end }, newText: `${gap}[[${name}]]:\n` }] };
    }

    function mergeEdits(a: WorkspaceEdit, b: WorkspaceEdit): WorkspaceEdit {
        const merged: WorkspaceEdit = { ...a };
        for (const [file, edits] of Object.entries(b)) merged[file] = [...merged[file] ?? [], ...edits];
        return merged;
    }

    async function askSectionName(): Promise<string | null> {
        const graph = storyGraph;
        const name = (await promptDialog("New section name:", "", "Add"))?.trim();
        if (!name || !graph) return null;
        const problem = checkSectionName(name, graph);
        if (problem) {
            showToast(problem, "info");
            return null;
        }
        return name;
    }

    // Adds a section, where it was asked for on the map, in the same file as the section it's
    // near (or the file that's open, or the main file)
    async function createSectionFromMap(at: Point, near: GraphNode | undefined, linkFrom?: GraphNode) {
        if (!p) return;
        const name = await askSectionName();
        if (!name || !p) return;
        const file = linkFrom?.location.file ?? near?.location.file ?? (isSquiffyFile(p.activePath) ? p.activePath : p.mainFile);
        try {
            let edit = await newSectionEdit(file, name);
            if (linkFrom) edit = mergeEdits(linkEdit(linkFrom, `[[${name}]]`), edit);
            savePositions(withPosition(mapPositions, { kind: "section", name }, at));
            selectWhenReady = `section:${name}`;
            await applyEdits(edit);
        } catch (err) {
            showToast(`Couldn't add the section: ${errorText(err)}`);
        }
    }

    async function linkFromMap(from: GraphNode, to: GraphNode | null, at: Point) {
        if (!to) {
            await createSectionFromMap(at, from, from);
            return;
        }
        const link = linkTo(from, to);
        if ("error" in link) {
            showToast(link.error, "info");
            return;
        }
        await applyEdits(linkEdit(from, link.text));
    }

    async function renameFromMap(node: GraphNode) {
        const c = client;
        if (!c || node.detail) return;
        const name = (await promptDialog(`Rename the ${node.kind} "${node.name}" to:`, node.name, "Rename"))?.trim();
        if (!name || name === node.name) return;
        await syncOpenFiles();
        const result = await c.call("getRenameEdits", node.location.file, node.location.range.start, name);
        if (!result) return;
        if ("error" in result) {
            showToast(result.error, "info");
            return;
        }
        await applyEdits(result.edit);
    }

    async function relayoutMap(): Promise<boolean> {
        const saved = mapPositions && (Object.keys(mapPositions.sections).length || Object.keys(mapPositions.passages).length);
        if (saved) {
            if (!(await confirmDialog("Lay out the map again? Everything you've moved by hand goes back to where the map puts it.", { confirmLabel: "Lay out again" }))) return false;
            savePositions({ sections: {}, passages: {} });
        }
        return true;
    }

    // ---- Squiffy 5 ----

    // When a .squiffy file with Squiffy 5 text processor syntax opens, offer to convert all of it,
    // as the 6.x editor does. Once per file each time the editor's opened: the quick fixes on
    // each line are still there if the author says no.
    const offeredV5 = new Set<string>();
    $effect(() => {
        const c = client;
        const current = p;
        if (!c || !current) return;
        for (const file of current.openFiles) {
            if (!isSquiffyFile(file.path) || offeredV5.has(file.path)) continue;
            offeredV5.add(file.path);
            void offerV5Conversion(c, file.path, file.text);
        }
    });

    async function offerV5Conversion(c: LanguageClient, path: string, text: string) {
        const count = await c.call("countV5Syntax", text);
        if (count === 0) return;
        const convert = await chooseDialog(
            `${path} uses the Squiffy 5 text processor (${count} ${count === 1 ? "place" : "places"}). Convert it to Squiffy 6's?\n\nYou can undo this.`,
            [
                { label: "Not now", value: false },
                { label: "Convert", value: true },
            ],
        );
        const view = views.get(path);
        if (!convert || !view) return;
        const result = await c.call("convertV5Syntax", view.state.doc.toString());
        if (result.converted > 0) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result.script } });
        }
        const left = result.problems.length;
        showToast(
            `Converted ${result.converted} Squiffy 5 ${result.converted === 1 ? "command" : "commands"}.`
            + (left ? ` ${left} couldn't be converted automatically, and are marked as problems.` : ""),
            "info",
            10000,
        );
    }

    // ---- Export ----

    // Publishes the story, as it is in the editor now
    async function handleExport(kind: ExportKind) {
        const current = p;
        const c = client;
        if (!current || !c) return;
        try {
            await syncOpenFiles();
            const { fileName, saveBlob, storyAssets } = await import("#lib/export.js");
            const result = await c.call("exportStory", kind, kind === "js" ? {} : await storyAssets(current));
            if (!result.success) {
                showToast(`The story can't be published until this is fixed: ${result.errors[0]}`);
                return;
            }
            if (kind === "zip" && result.zip) {
                saveBlob(new Blob([result.zip as BlobPart], { type: "application/zip" }), fileName(current.displayName, " (web).zip"));
            } else if (kind === "html") {
                saveBlob(new Blob([result.files["index.html"]], { type: "text/html" }), fileName(current.displayName, ".html"));
            } else if (kind === "js") {
                saveBlob(new Blob([result.files["story.js"]], { type: "text/javascript" }), "story.js");
            }
        } catch (err) {
            showToast(`Couldn't publish the story: ${errorText(err)}`);
        }
    }

    // The published story, in a tab of its own, as players will see it (the 6.x editor's Preview).
    // The tab is opened straight away, during the click, so a popup blocker lets it through.
    async function handlePlayInTab() {
        const current = p;
        const c = client;
        if (!current || !c) return;
        const tab = window.open("", "_blank");
        try {
            await syncOpenFiles();
            const { storyAssets } = await import("#lib/export.js");
            const result = await c.call("exportStory", "html", await storyAssets(current));
            if (!result.success) {
                tab?.close();
                showToast(`The story can't run until this is fixed: ${result.errors[0]}`);
                return;
            }
            const url = URL.createObjectURL(new Blob([result.files["index.html"]], { type: "text/html" }));
            if (tab) tab.location.href = url;
            else showToast("The browser blocked the new tab.", "info");
        } catch (err) {
            tab?.close();
            showToast(`Couldn't play the story: ${errorText(err)}`);
        }
    }

    // The whole project, with any unsaved changes, as a zip that Open file reads back
    async function handleDownloadProject() {
        const current = p;
        if (!current) return;
        try {
            const { fileName, saveBlob, zipProject } = await import("#lib/export.js");
            saveBlob(new Blob([await zipProject(current) as BlobPart], { type: "application/zip" }), fileName(current.displayName, ".zip"));
        } catch (err) {
            showToast(`Couldn't download the project: ${errorText(err)}`);
        }
    }

    // ---- Files ----

    function errorText(err: unknown) {
        return err instanceof Error ? err.message : String(err);
    }

    // Checks a path the author typed, and says what's wrong with it
    function validPath(path: string): boolean {
        try {
            parsePath(path);
            return true;
        } catch (err) {
            showToast(errorText(err));
            return false;
        }
    }

    // A new .squiffy file is part of the story straight away. With a squiffy.json, that's
    // automatic. Without one, the editor offers to add one, or else @imports it from the main file.
    async function handleNewFile() {
        if (!p) return;
        const name = await promptDialog("New file name:", "chapter.squiffy", "Create");
        if (!name) return;
        const path = joinPath(dirname(p.mainFile), name.trim());
        if (!validPath(path)) return;
        const squiffy = isSquiffyFile(path);
        try {
            if (await p.fs.exists(path)) throw new Error(`There's already a file called ${path}.`);
            let offer: ProjectOffer | null = null;
            if (squiffy && !p.projectFile && p.projectText === null) {
                offer = await offerProjectFile(p, { main: p.mainFile, adding: path });
                if (offer === "cancelled") return;
            }
            await p.createFile(path, squiffy ? `[[${basename(path).replace(/\.squiffy$/i, "")}]]:\n\n` : "");
            if (offer === "declined") await addImport(storyPath(p, path));
            if (isTextFile(path)) await p.open(path);
        } catch (err) {
            showToast(errorText(err));
        }
    }

    // Adds "@import path" to the main file, after its @title and other @imports
    async function addImport(path: string) {
        if (!p) return;
        const main = p.fileAt(p.mainFile);
        const text = main ? main.text : await p.fs.readText(p.mainFile);
        const lines = text.split("\n");
        let at = 0;
        lines.forEach((line, i) => {
            if (/^@(import|title)\b/.test(line)) at = i + 1;
        });
        const view = views.get(p.mainFile);
        const line = `@import ${path}`;
        if (view) {
            const pos = at < view.state.doc.lines ? view.state.doc.line(at + 1).from : view.state.doc.length;
            view.dispatch({ changes: { from: pos, insert: `${line}\n` } });
        } else {
            lines.splice(at, 0, line);
            await p.fs.write(p.mainFile, lines.join("\n"));
            p.onFileChanged?.(p.mainFile);
        }
        showToast(`Added "${line}" to ${p.mainFile}.`, "info");
    }

    async function handleRename(path: string) {
        if (!p) return;
        const name = await promptDialog(`Rename ${path} to:`, path, "Rename");
        const to = name?.trim();
        if (!to || to === path || !validPath(to)) return;
        try {
            await p.renameFile(path, to);
            if (isSquiffyFile(path)) showToast("If another file @imports this one by name, change its @import too.", "info");
        } catch (err) {
            showToast(errorText(err));
        }
    }

    // Starring a file. With a squiffy.json, that changes its "main"; without one, the editor
    // offers to add one, or else just remembers the new main file in the browser.
    async function handleMakeMain(path: string) {
        if (!p) return;
        try {
            if (!p.projectFile && p.projectText === null) {
                // "created" makes it the main file in the new squiffy.json
                if ((await offerProjectFile(p, { main: path })) !== "declined") return;
            }
            await p.setMainFile(path);
        } catch (err) {
            showToast(errorText(err));
        }
    }

    async function handleExclude(path: string, excluded: boolean) {
        if (!p) return;
        try {
            const problem = await p.setExcluded(path, excluded);
            if (problem) showToast(problem, "info");
        } catch (err) {
            showToast(errorText(err));
        }
    }

    async function handleDelete(path: string) {
        if (!p) return;
        if (path === p.mainFile) {
            showToast("This is the main file. Make another file the main one before deleting it.", "info");
            return;
        }
        if (!(await confirmDialog(`Delete ${path}? This can't be undone.`, { confirmLabel: "Delete", danger: true }))) return;
        try {
            await p.deleteFile(path);
        } catch (err) {
            showToast(errorText(err));
        }
    }

    function handleOpenFile(path: string) {
        if (!p) return;
        if (isTextFile(path)) {
            narrowPane = "editor";
            void p.open(path).catch(err => showToast(errorText(err)));
        } else {
            assetsOpen = true;
        }
    }

    // Puts a reference to an asset at the cursor: an <img> for an image, else the path
    function insertAsset(path: string, image: boolean) {
        assetsOpen = false;
        const view = activeView();
        if (!view) return;
        view.dispatch(view.state.replaceSelection(image ? `<img src="${path}" alt="">` : path));
        view.focus();
    }

    // Drags a splitter: the sidebar's is on its right, the preview's on its left. The
    // splitter captures the pointer, and iframes stop taking pointer events while it's
    // dragged, as otherwise the preview's iframe swallows the moves whenever the pointer
    // crosses into it, and the resize stutters.
    function handleSplitterPointerDown(e: PointerEvent, panel: "sidebar" | "preview" | "map") {
        if (e.button !== 0) return;
        e.preventDefault();
        const splitter = e.currentTarget as HTMLElement;
        const startX = e.clientX;
        const startWidth = panel === "sidebar" ? sidebarWidth : panel === "map" ? mapWidth : previewWidth;
        const [min, max] = panel === "sidebar" ? SIDEBAR_LIMITS : panel === "map" ? MAP_LIMITS : PREVIEW_LIMITS;
        splitter.setPointerCapture(e.pointerId);
        document.body.classList.add("splitter-dragging");

        function onMove(moveEvent: PointerEvent) {
            const delta = moveEvent.clientX - startX;
            const next = Math.min(max, Math.max(min, startWidth + (panel === "sidebar" ? delta : -delta)));
            if (panel === "sidebar") sidebarWidth = next;
            else if (panel === "map") mapWidth = next;
            else previewWidth = next;
        }
        function onUp() {
            splitter.removeEventListener("pointermove", onMove);
            splitter.removeEventListener("pointerup", onUp);
            splitter.removeEventListener("pointercancel", onUp);
            document.body.classList.remove("splitter-dragging");
        }
        splitter.addEventListener("pointermove", onMove);
        splitter.addEventListener("pointerup", onUp);
        splitter.addEventListener("pointercancel", onUp);
    }
</script>

<svelte:head>
    <title>{p ? `${p.displayName} - Squiffy` : "Squiffy"}</title>
</svelte:head>

{#if loading || !p}
    <main class="flex flex-col items-center justify-center min-h-svh gap-6 p-8">
        <div class="size-10 rounded-full border-4 border-surface-300-700 border-t-primary-500 animate-spin"></div>
        <p class="text-surface-600-400 text-sm">Opening story…</p>
    </main>
{:else}
    <a
        href="#editor"
        class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[1000] focus:rounded focus:bg-primary-500 focus:text-white focus:px-3 focus:py-2 focus:text-sm"
    >Skip to editor</a>
    <main class="flex flex-col h-dvh overflow-hidden safe-area-inset">
        <Toolbar
            outlineOpen={narrowPane === "outline"}
            ontoggleoutline={() => { narrowPane = narrowPane === "outline" ? "editor" : "outline"; }}
            mapOpen={mapOpen && (!isNarrow.current || narrowPane === "map")}
            ontogglemap={toggleMap}
            onrun={fromCursor => runPreview(fromCursor)}
            onassets={() => { assetsOpen = true; }}
            ondownloadproject={handleDownloadProject}
            onexport={handleExport}
            oncommand={command => { const v = activeView(); if (v) runCommand(v, command); }}
            onadd={kind => { const v = activeView(); if (v && isSquiffyFile(p.activePath)) addSectionOrPassage(v, kind, symbols); }}
            onsnippet={content => { const v = activeView(); if (v) insertSnippet(v, content); }}
            {snippets}
            onabout={() => { aboutOpen = true; }}
            onplaytab={handlePlayInTab}
        />
        <div class="flex flex-1 overflow-hidden">
            {#if isNarrow.current ? narrowPane === "outline" : !(mapOpen && mapMaximized)}
                <div
                    class="flex flex-col shrink-0 overflow-hidden bg-surface-50-950 border-r border-surface-200-800 {isNarrow.current ? "flex-1" : ""}"
                    style={isNarrow.current ? undefined : `width: ${sidebarWidth}px`}
                >
                    <div class="max-h-[40%] flex flex-col border-b border-surface-200-800">
                        <FilesPanel
                            project={p}
                            onnewfile={handleNewFile}
                            onrename={handleRename}
                            ondelete={handleDelete}
                            ondownload={path => void downloadFile(path)}
                            onmakemain={handleMakeMain}
                            onexclude={handleExclude}
                            onopen={handleOpenFile}
                        />
                    </div>
                    <OutlinePanel
                        bind:this={outline}
                        bind:query={outlineQuery}
                        {symbols}
                        {cursorLine}
                        onselect={goToSymbol}
                    />
                </div>
            {/if}
            {#if !isNarrow.current && !(mapOpen && mapMaximized)}
                <div
                    role="separator"
                    aria-orientation="vertical"
                    class="splitter"
                    onpointerdown={e => handleSplitterPointerDown(e, "sidebar")}
                ></div>
            {/if}
            <!-- Kept mounted (hidden, not removed) on a narrow screen so the cursor and undo
                 history survive opening the sidebar or the preview -->
            <div id="editor" class="flex-1 min-w-0 flex flex-col {(isNarrow.current && narrowPane !== "editor") || (!isNarrow.current && mapOpen && mapMaximized) ? "hidden" : ""}">
                <EditorTabs project={p} />
                <!-- One editor per open file, so each keeps its own cursor and undo history -->
                {#each p.openFiles as file (file.path)}
                    <div class="flex-1 min-h-0 {file.path === p.activePath ? "" : "hidden"}">
                        <CodeEditor
                            value={file.text}
                            extensions={extensionsFor(file.path)}
                            onChange={text => file.setText(text)}
                            onSave={() => void p.save()}
                            onCursor={offset => handleCursor(file.path, offset)}
                            onView={v => { if (v) views.set(file.path, v); }}
                        />
                    </div>
                {:else}
                    <p class="flex-1 p-6 text-sm text-surface-600-400">Open a file from the list on the left.</p>
                {/each}
                {#if references}
                    <ReferencesPanel
                        name={references.name}
                        locations={references.locations}
                        textOf={file => p.fileAt(file)?.text}
                        onselect={goToLocation}
                        onclose={() => { references = null; activeView()?.focus(); }}
                    />
                {/if}
            </div>
            {#if mapOpen && (!isNarrow.current || narrowPane === "map")}
                {#if !isNarrow.current && !mapMaximized}
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        class="splitter"
                        onpointerdown={e => handleSplitterPointerDown(e, "map")}
                    ></div>
                {/if}
                <MapPanel
                    bind:this={mapPanel}
                    graph={storyGraph}
                    positions={mapPositions}
                    query={outlineQuery}
                    current={currentNode}
                    {trace}
                    maximized={mapMaximized}
                    width={isNarrow.current || mapMaximized ? undefined : mapWidth}
                    ongoto={(node, focus) => { const location = node.graphNode?.location; if (location) goFromMap(location, focus); }}
                    ongotoedge={(edge: StoryMapEdge) => goFromMap(edge.edges[0].location, false)}
                    onmove={moves => savePositions(moves.reduce((positions, { node, at }) => withPosition(positions, node, at), mapPositions ?? { sections: {}, passages: {} }))}
                    onlink={linkFromMap}
                    oncreate={(at, near) => void createSectionFromMap(at, near)}
                    onrename={node => void renameFromMap(node)}
                    onrun={node => void runPreview(false, node.kind === "section" ? { section: node.name } : { section: node.section!, passage: node.name })}
                    onrelayout={relayoutMap}
                    ontogglemaximized={() => { mapMaximized = !mapMaximized; }}
                    onclose={() => { mapOpen = false; mapMaximized = false; narrowPane = "editor"; }}
                />
            {/if}
            {#if previewOpen}
                {#if !isNarrow.current}
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        class="splitter"
                        onpointerdown={e => handleSplitterPointerDown(e, "preview")}
                    ></div>
                {/if}
                <!-- Also kept mounted while hidden on a narrow screen, so the story keeps its place -->
                <div class={isNarrow.current && narrowPane !== "preview" ? "hidden" : "contents"}>
                    <PreviewPanel
                        bind:this={preview}
                        compile={compileStory}
                        assets={previewAssets}
                        {assetsVersion}
                        onNavigated={(section, passage) => void followPreview(section, passage)}
                        onStarted={() => { trace = []; }}
                        onVisited={(section, passage) => { trace = [...trace.slice(-499), { section, passage }]; }}
                        onclose={() => { previewOpen = false; narrowPane = "editor"; }}
                        width={isNarrow.current ? undefined : previewWidth}
                    />
                </div>
            {/if}
        </div>
    </main>

    {#if aboutOpen}
        <AboutModal onclose={() => { aboutOpen = false; }} />
    {/if}

    {#if assetsOpen}
        <AssetManagerModal project={p} oninsert={insertAsset} oncancel={() => { assetsOpen = false; }} />
    {/if}
{/if}

<style>
    .splitter {
        width: 0.25rem;
        flex-shrink: 0;
        cursor: col-resize;
        transition: background-color 150ms;
    }
    .splitter:hover {
        background-color: color-mix(in srgb, var(--color-primary-500) 50%, transparent);
    }
    .splitter:active {
        background-color: color-mix(in srgb, var(--color-primary-500) 70%, transparent);
    }
    :global(body.splitter-dragging) {
        cursor: col-resize;
        user-select: none;
    }
    :global(body.splitter-dragging iframe) {
        pointer-events: none;
    }
</style>

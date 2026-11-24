<script lang="ts">
    // The editor: toolbar; files and outline; a tab and a code editor for each open file; and the
    // preview. Laid out like Quest Viva's edit page.
    import { onMount, tick, untrack } from "svelte";
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { EditorView } from "@codemirror/view";
    import type { Extension } from "@codemirror/state";
    import type { DocumentSymbol, GraphNode, Location, StoryGraph, WorkspaceEdit } from "squiffy-compiler/language-service";
    import { PROJECT_FILENAME, type MapPositions } from "squiffy-compiler";
    import { basename, dirname, extname, guessMimeType, joinPath, parsePath } from "@textadventures/project-fs";
    import { base } from "#lib/base-path.js";
    import { project, openBrowserStory, openRecentFolder, downloadFile, storyPath, offerProjectFile, setterConversionMessage, type ProjectOffer } from "#lib/project.svelte.js";
    import { isAsset, isSquiffyFile, isTextFile } from "#lib/file-types.js";
    import { NEW_FILE_KINDS, needsImport, newFileText, type NewFileKind } from "#lib/new-file.js";
    import { createLanguageClient, type LanguageClient } from "#lib/language/client.js";
    import { applyEditsToString, applyTextEdits, languageCommands, languageFeatures, recheckProblems, toOffset, toPosition } from "#lib/language/codemirror.js";
    import { squiffyLanguage } from "@textadventures/squiffy-codemirror";
    import { css } from "@codemirror/lang-css";
    import { javascript } from "@codemirror/lang-javascript";
    import { isNarrow } from "#lib/layout.svelte.js";
    import { showToast } from "#lib/toast.js";
    import { chooseDialog, confirmDialog, promptDialog } from "#lib/confirm.js";
    import { redo, undo } from "@codemirror/commands";
    import BackupBanner from "#components/BackupBanner.svelte";
    import DiskChangeBar from "#components/DiskChangeBar.svelte";
    import Toolbar from "#components/Toolbar.svelte";
    import FilesPanel from "#components/FilesPanel.svelte";
    import OutlinePanel from "#components/OutlinePanel.svelte";
    import EditorTabs from "#components/EditorTabs.svelte";
    import CodeEditor from "#components/CodeEditor.svelte";
    import ReferencesPanel from "#components/ReferencesPanel.svelte";
    import ProblemsPanel from "#components/ProblemsPanel.svelte";
    import FindInFilesPanel from "#components/FindInFilesPanel.svelte";
    import { findInFiles, isSearchable, type FindResults } from "#lib/find-in-files.js";
    import { isValidSearch, replaceChanges, replaceInText, type SearchSpec, type TextMatch } from "@textadventures/editor-search";
    import { collectProblems, countProblems, type Problem } from "#lib/problems.js";
    import type { CodeAction } from "squiffy-compiler/language-service";
    import PreviewPanel from "#components/PreviewPanel.svelte";
    import MapPanel, { type TraceStep } from "#components/MapPanel.svelte";
    import { checkSectionName, emptyPositions, linkTo, movedNodes, nodeAtLine, renamePositions, revertPositions, sectionKeys, withPosition, type Point, type StoryMapEdge, type StoryMapNode } from "#lib/story-map.js";
    import AssetManagerModal from "#components/AssetManagerModal.svelte";
    import FontsModal from "#components/FontsModal.svelte";
    import StoryDetailsModal from "#components/StoryDetailsModal.svelte";
    import PublishModal from "#components/PublishModal.svelte";
    import type { StoryLink } from "#lib/share-link.js";
    import AboutModal from "#components/AboutModal.svelte";
    import ContextMenu, { type ContextMenuItem } from "#components/ContextMenu.svelte";
    import Pencil from "@lucide/svelte/icons/pencil";
    import Play from "@lucide/svelte/icons/play";
    import Code from "@lucide/svelte/icons/code";
    import X from "@lucide/svelte/icons/x";
    import { readMapLayout, saveMapLayout } from "#lib/map-layout.js";
    import { narrowed, narrowing, narrowRange, setNarrow } from "#lib/narrow.js";
    import { checkPassageName, deleteLinesEdits, deletionMessage, insertHeaderEdit, linkThenHeaderEdits, placeNewPassage, placeNewSection, planDeletion, startEdit, type Place } from "#lib/map-edits.js";
    import { addSectionOrPassage, clipboardCommand, insertSnippet, runCommand, userSnippets } from "#lib/editor-commands.js";
    import { formatKey } from "#lib/shortcuts.js";
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
    // Every problem in the story, for the Problems panel and the toolbar's count
    let problems = $state.raw<Problem[]>([]);
    let problemCounts = $derived(countProblems(problems));
    let problemsOpen = $state(false);
    // Session-only, like the other panels' sizes
    let problemsHeight = $state(200);
    let problemsPanel = $state<ReturnType<typeof ProblemsPanel>>();
    // Find in Files (Ctrl/Cmd+Shift+F): what to search for, and what was found
    let findOpen = $state(false);
    let findSpec = $state<SearchSpec>({ search: "" });
    let findResults = $state<FindResults | null>(null);
    let findHeight = $state(240);
    let findPanel = $state<ReturnType<typeof FindInFilesPanel>>();
    let findReplace = $state("");
    let findReplaceOpen = $state(false);
    let findInvalid = $derived(!!findSpec.search && !isValidSearch(findSpec));
    // The text of each open file when the problems were found, as their fixes are for that text
    let problemTexts = new Map<string, string>();
    let assetsOpen = $state(false);
    let fontsOpen = $state(false);
    let detailsOpen = $state(false);
    let publishOpen = $state(false);
    // Story details was opened from the Publish dialog, which closing it goes back to
    let detailsFromPublish = false;
    let aboutOpen = $state(false);
    // The code editor's right-click menu
    let editorMenu = $state<{ view: EditorView; x: number; y: number; keyboard: boolean; items: ContextMenuItem[] } | null>(null);
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
    // Whether the map's open and full screen is remembered for each story, once it's been read
    let layoutRead = $state(false);
    $effect(() => {
        const id = p?.source.id;
        const layout = { open: mapOpen, maximized: mapOpen && mapMaximized };
        if (id && layoutRead && !isNarrow.current) saveMapLayout(id, layout);
    });
    const SIDEBAR_LIMITS = [160, 500] as const;
    const PREVIEW_LIMITS = [280, 900] as const;
    const MAP_LIMITS = [280, 1400] as const;
    const CARD_LIMITS = [280, Infinity] as const;
    // How much of the map the card always leaves showing on its left
    const CARD_MAP_LEFT = 160;

    // On a narrow screen one pane shows at a time: the editor, the sidebar or the preview
    let narrowPane = $state<"editor" | "outline" | "preview" | "map">("editor");

    const activeView = () => (p ? views.get(p.activePath) : undefined);
    let symbols = $derived(p ? symbolsByPath[p.activePath] ?? [] : []);
    // The author's own snippets, in the open files
    let snippets = $derived(p ? p.openFiles.flatMap(f => userSnippets(symbolsByPath[f.path] ?? [], f.text)) : []);

    onMount(() => {
        void (async () => {
            const storyId = page.url.searchParams.get("story");
            const folderId = page.url.searchParams.get("folder");
            const current = project.current;
            const isOpen = current !== null && current.source.id === (storyId ?? folderId);
            try {
                if (storyId && !isOpen) await openBrowserStory(storyId);
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
            // The map as it was left, for an author who works there. Not on a narrow screen,
            // where it would take the script's place.
            const layout = readMapLayout(project.current.source.id);
            if (layout && !isNarrow.current) {
                mapOpen = layout.open;
                mapMaximized = layout.maximized;
            }
            layoutRead = true;
            loading = false;
        })();

        // Saves when the author switches away, and on coming back, looks for changes made
        // outside the editor meanwhile (e.g. by an AI agent), which a folder opened in the
        // browser can't report as they happen
        function handleVisibilityChange() {
            if (document.hidden) void project.current?.save();
            else void project.current?.checkDisk();
        }
        function handleFocus() {
            void project.current?.checkDisk();
        }
        // Ctrl/Cmd+Shift+O: go to a section or passage, from the outline's search box.
        // Ctrl/Cmd+Enter: run the story; with Shift, from the section the cursor is in. Caught
        // before the editor sees them, since Ctrl/Cmd+Enter would otherwise add a line.
        function handleKeydown(e: KeyboardEvent) {
            if (!(e.metaKey || e.ctrlKey)) return;
            if (e.shiftKey && e.key.toLowerCase() === "m") {
                // Instead of CodeMirror's own panel, which only lists the open file's problems
                e.preventDefault();
                e.stopPropagation();
                void toggleProblems();
            } else if (e.shiftKey && e.key.toLowerCase() === "f") {
                e.preventDefault();
                e.stopPropagation();
                void openFindInFiles();
            } else if (e.shiftKey && e.key.toLowerCase() === "o") {
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
        window.addEventListener("focus", handleFocus);
        window.addEventListener("keydown", handleKeydown, true);
        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("focus", handleFocus);
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
                // For writing one section from the full-screen map. Escape goes back to the map.
                narrowing(() => mapPanel?.focus()),
                languageFeatures({
                    client: c,
                    path,
                    onSymbols: s => {
                        symbolsByPath = { ...symbolsByPath, [path]: s };
                        if (path === current.mainFile) current.setTitle(s.find(x => x.kind === "title")?.name ?? "");
                    },
                    onNavigate: goToLocation,
                    takeNavigation: location => {
                        if (!cardShown) return false;
                        void goToLocation(location);
                        return true;
                    },
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

    // The code editor's right-click menu, instead of the browser's: Go to definition, Find
    // references and Rename (in a .squiffy file), then cut, copy and paste, and Find. Shift and
    // right-click still gets the browser's menu, as does a long press on a touchscreen, where its
    // menu is how text is selected and pasted.
    function handleEditorContextMenu(view: EditorView, event: MouseEvent): boolean {
        // From the menu key or Shift+F10 rather than the mouse
        const keyboard = "pointerType" in event ? event.pointerType === "" : event.clientX === 0 && event.clientY === 0;
        if (!keyboard && (event.shiftKey || (event as PointerEvent).pointerType === "touch")) return false;
        let offset = view.state.selection.main.head;
        let { clientX: x, clientY: y } = event;
        if (keyboard) {
            const coords = view.coordsAtPos(offset);
            if (coords) ({ left: x, bottom: y } = coords);
        } else {
            // The cursor moves to where was clicked, unless that's in the selection
            const at = view.posAtCoords({ x, y });
            if (at !== null) {
                offset = at;
                if (!view.state.selection.ranges.some(r => r.from <= at && at <= r.to)) view.dispatch({ selection: { anchor: at } });
            }
        }
        void showEditorMenu(view, offset, x, y, keyboard);
        return true;
    }

    async function showEditorMenu(view: EditorView, offset: number, x: number, y: number, keyboard: boolean) {
        const commands = view.state.facet(languageCommands);
        const onName = commands ? await commands.hasDefinition(view, offset).catch(() => false) : false;
        const readOnly = view.state.readOnly;
        const hasSelection = view.state.selection.ranges.some(r => !r.empty);
        const clipboard = (command: "cut" | "copy" | "paste", key: string) => {
            void clipboardCommand(view, command).then(done => {
                if (!done) showToast(`The browser didn't allow that from the menu. Press ${formatKey(key)} instead.`, "info");
            });
        };
        const items: ContextMenuItem[] = [];
        if (commands) {
            items.push(
                { label: "Go to definition", shortcut: formatKey("F12"), disabled: !onName, action: () => commands.definition(view) },
                { label: "Find references", shortcut: formatKey("Shift-F12"), disabled: !onName, action: () => commands.references(view) },
                { label: "Rename…", shortcut: formatKey("F2"), disabled: !onName || readOnly, action: () => commands.rename(view) },
            );
        }
        items.push(
            { label: "Cut", shortcut: formatKey("Mod-x"), disabled: !hasSelection || readOnly, divider: items.length > 0, action: () => clipboard("cut", "Mod-x") },
            { label: "Copy", shortcut: formatKey("Mod-c"), disabled: !hasSelection, action: () => clipboard("copy", "Mod-c") },
            { label: "Paste", shortcut: formatKey("Mod-v"), disabled: readOnly, action: () => clipboard("paste", "Mod-v") },
            { label: "Find and replace", shortcut: formatKey("Mod-f"), divider: true, action: () => runCommand(view, "find") },
            { label: "Find in files", shortcut: formatKey("Mod-Shift-f"), action: () => void openFindInFiles() },
        );
        editorMenu = { view, x, y, keyboard, items };
    }

    function closeEditorMenu() {
        const view = editorMenu?.view;
        editorMenu = null;
        view?.focus();
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
        if (await goToInCard(location, true)) return;
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

    // Compiles the story as it is in the editor now, for the preview. The language service reads
    // anything but a .squiffy file (a stylesheet, a script, squiffy.json) from the project, so
    // those are saved first, or the preview would show them as they were at the last autosave.
    async function compileStory() {
        const current = p;
        if (!client || !current) return { success: false as const, errors: ["The story isn't open."] };
        await Promise.all(current.openFiles.filter(f => f.dirty && !isSquiffyFile(f.path)).map(f => f.save()));
        await syncOpenFiles();
        return client.call("getPreviewStory");
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

    // The sections the preview's Start at menu lists, as the story is now
    async function previewSections() {
        if (!client) return [];
        await syncOpenFiles();
        const { startSections } = await import("#lib/start-sections.js");
        return startSections(await client.call("getStoryGraph"));
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

    // Edits hot-update the running story, once typing pauses, as do changes to files that aren't
    // open, such as a font's stylesheet from the Fonts dialog
    $effect(() => {
        void p?.openFiles.map(f => f.text);
        void filesVersion;
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

    // ---- Problems ----

    // Find the story's problems again as it changes, once typing pauses
    let problemsRequest = 0;
    $effect(() => {
        void p?.openFiles.map(f => f.text);
        void filesVersion;
        void p?.mainFile;
        if (!client) return;
        const timer = setTimeout(() => void refreshProblems(), 500);
        return () => clearTimeout(timer);
    });

    async function refreshProblems() {
        const c = client;
        const current = p;
        if (!c || !current) return;
        const request = ++problemsRequest;
        const texts = new Map(current.openFiles.map(f => [f.path, f.text]));
        await syncOpenFiles();
        const found = await c.call("getProblems");
        if (request !== problemsRequest) return;
        problemTexts = texts;
        problems = collectProblems(found, current.mainFile);
    }

    // Back to the script after closing a panel, or to the map if it's full screen and hiding it
    function focusWork() {
        if (mapOpen && mapMaximized && !cardShown && !isNarrow.current) mapPanel?.focus();
        else activeView()?.focus();
    }

    async function toggleProblems() {
        if (problemsOpen) {
            problemsOpen = false;
            focusWork();
            return;
        }
        problemsOpen = true;
        narrowPane = "editor";
        await tick();
        problemsPanel?.focus();
    }

    // Opens Find in Files, or goes back to its search box. Text selected in the editor, on one
    // line, is what it searches for.
    async function openFindInFiles() {
        const state = activeView()?.state;
        const selected = state && !state.selection.main.empty ? state.sliceDoc(state.selection.main.from, state.selection.main.to) : "";
        if (selected && !selected.includes("\n")) findSpec = { ...findSpec, search: findSpec.regexp ? selected.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&") : selected };
        findOpen = true;
        narrowPane = "editor";
        await tick();
        findPanel?.focus();
    }

    function closeFindInFiles() {
        findOpen = false;
        focusWork();
    }

    // Searches again a moment after the search, the list of files or the text of an open file
    // changes, so the results keep up with the author's typing. An open file is searched as it
    // is in its editor, saved or not.
    let findRequest = 0;
    $effect(() => {
        const current = p;
        if (!findOpen || !current) return;
        const spec = $state.snapshot(findSpec);
        const paths = current.files.map(f => f.path).filter(isSearchable);
        const open = new Map(current.openFiles.map(f => [f.path, f.text]));
        const request = ++findRequest;
        if (!spec.search || !isValidSearch(spec)) {
            findResults = null;
            return;
        }
        const read = async (path: string) => {
            const text = open.get(path);
            if (text !== undefined) return text;
            try {
                return await current.fs.readText(path);
            } catch {
                return undefined;
            }
        };
        const timer = setTimeout(async () => {
            const results = await findInFiles(paths, read, spec);
            if (request === findRequest) findResults = results;
        }, 200);
        return () => clearTimeout(timer);
    });

    // Replaces the matches in one file, or with `only`, one of them. An open file is changed in
    // its editor, as one step to undo there; others are changed on disk. Returns how many.
    async function replaceInFile(current: NonNullable<typeof p>, file: string, spec: SearchSpec, only?: TextMatch): Promise<number> {
        const view = views.get(file);
        if (view && current.isOpen(file)) {
            const changes = replaceChanges(view.state.doc, spec, findReplace, only);
            if (changes.length) view.dispatch({ changes, userEvent: "input.replace" });
            return changes.length;
        }
        const replaced = replaceInText(await current.fs.readText(file), spec, findReplace, only);
        if (replaced.count) await current.writeText(file, replaced.text);
        return replaced.count;
    }

    async function replaceMatch(file: string, match: TextMatch) {
        const current = p;
        if (!current) return;
        try {
            const count = await replaceInFile(current, file, $state.snapshot(findSpec), match);
            if (!count) showToast("That text has changed since the search.", "info");
        } catch (err) {
            showToast(`Couldn't change ${file}: ${errorText(err)}`);
        }
    }

    // Replaces every match in every file, once the author has agreed: files that aren't open
    // have no undo
    async function replaceAllInFiles() {
        const current = p;
        const found = findResults;
        if (!current || !found?.total) return;
        const spec = $state.snapshot(findSpec);
        const closed = found.files.filter(f => !current.isOpen(f.file)).length;
        const matches = `${found.total}${found.capped ? "+" : ""} match${found.total === 1 && !found.capped ? "" : "es"}`;
        const where = found.capped ? "the story's files" : `${found.files.length} file${found.files.length === 1 ? "" : "s"}`;
        const warning = closed || found.capped ? " Changes to files that aren't open can't be undone." : "";
        const agreed = await chooseDialog(`Replace ${matches} in ${where} with '${findReplace}'?${warning}`, [
            { label: "Cancel", value: false },
            { label: "Replace all", value: true },
        ]);
        if (!agreed) return;
        let total = 0;
        let files = 0;
        for (const file of current.files.map(f => f.path).filter(isSearchable)) {
            try {
                const count = await replaceInFile(current, file, spec);
                total += count;
                if (count) files++;
            } catch (err) {
                showToast(`Couldn't change ${file}: ${errorText(err)}`);
            }
        }
        showToast(`Replaced ${total} match${total === 1 ? "" : "es"} in ${files} file${files === 1 ? "" : "s"}.`, "info");
    }

    function goToMatch(file: string, match: TextMatch) {
        void goToLocation({
            file,
            range: { start: { line: match.line, character: match.column }, end: { line: match.endLine, character: match.endColumn } },
        });
    }

    function goToProblem(problem: Problem) {
        const d = problem.diagnostic;
        // Selecting the whole range of a problem that spans sections would scroll away from it
        const end = d.range.end.line === d.range.start.line ? d.range.end : d.range.start;
        void goToLocation({ file: d.file, range: { start: d.range.start, end } });
    }

    // Applies a quick fix, if the files it changes are still as they were when it was made
    async function applyFix(fix: CodeAction) {
        const current = p;
        if (!current) return;
        const stale = Object.keys(fix.edit).some(file => {
            const open = current.fileAt(file);
            return open && open.text !== problemTexts.get(file);
        });
        if (stale) {
            showToast("The story changed since that problem was found. Try again.", "info");
            void refreshProblems();
            return;
        }
        await applyEdits(fix.edit);
        void refreshProblems();
    }

    // ---- The story map ----

    const mapPositions = $derived(p?.projectFile ? p.projectFile.map : sessionPositions);

    // The section or passage the cursor's in, which the map highlights
    let currentNode = $derived(storyGraph && p && isSquiffyFile(p.activePath) ? nodeAtLine(storyGraph, p.activePath, cursorLine)?.id ?? null : null);

    // Read the graph again as the story changes, once typing pauses
    let graphRequest = 0;
    // The story has changed since the graph was read
    let graphStale = false;
    $effect(() => {
        void p?.openFiles.map(f => f.text);
        void filesVersion;
        if (!mapOpen || !client) return;
        graphStale = true;
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
        const cardDoc = card ? views.get(card.file)?.state.doc : undefined;
        await syncOpenFiles();
        const graph = await c.call("getStoryGraph");
        if (request !== graphRequest) return;
        graphStale = false;
        const before = storyGraph;
        if (before) {
            // Renamed sections and passages keep their places
            const renamed = movedNodes(before, graph);
            mapPanel?.rename(renamed);
            const cardMoved = card && renamed.find(([from]) => from === card?.id);
            if (card && cardMoved) card = { ...card, id: cardMoved[1] };
            const moved = renamePositions(mapPositions, before, graph);
            if (moved) void savePositions(moved);
        }
        storyGraph = graph;
        // Only if the story hasn't changed again since it was read
        if (cardResync && card && views.get(card.file)?.state.doc === cardDoc) {
            cardResync = false;
            resyncCard(graph);
        }
        // The section being written has gone
        if (card && !graph.nodes.some(n => n.id === card?.id)) closeCard();
        if (selectWhenReady && graph.nodes.some(n => n.id === selectWhenReady)) {
            const id = selectWhenReady;
            selectWhenReady = null;
            await tick();
            mapPanel?.focusNode(id);
        }
    }

    // ---- Writing on the map (#542) ----

    // With the map full screen, a section can be written without leaving it: its file's editor is
    // shown beside the map as a card, narrowed to that section and its passages (see narrow.ts).
    // It's the same editor, so undo, completion and problems are the script's.
    let card = $state<{ id: string; file: string } | null>(null);
    const cardNode = $derived(card ? storyGraph?.nodes.find(n => n.id === card?.id) : undefined);
    const cardShown = $derived(!!card && mapOpen && mapMaximized && !isNarrow.current);
    // The card floats over the right of the map, so opening it doesn't move the map. Where the
    // map is in the window:
    let mapArea = $state<{ top: number; right: number; width: number; height: number }>({ top: 0, right: 0, width: 0, height: 0 });
    // Its width can be dragged from its left edge, for the rest of the session. Until it has been,
    // it's under half the map. Either way it leaves some of the map showing.
    let cardWidthChosen = $state<number | null>(null);
    const cardWidth = $derived(Math.round(Math.max(CARD_LIMITS[0], Math.min(cardWidthChosen ?? Math.min(544, mapArea.width * 0.45), cardMaxWidth()))));
    function cardMaxWidth() {
        return Math.max(CARD_LIMITS[0], mapArea.width - CARD_MAP_LEFT);
    }

    // Shows a section in the card, or the section a passage is in, with the cursor at the passage
    // (or at `at`). If it's the section already shown, the cursor stays where it is.
    async function openCard(node: GraphNode, focus: boolean, at?: Location["range"]["start"]) {
        if (!p) return;
        if (graphStale) await refreshGraph();
        const graph = storyGraph;
        const sectionName = node.kind === "section" ? node.name : node.section!;
        const section = graph?.nodes.find(n => n.kind === "section" && n.name === sectionName);
        if (!p || !graph || !section || section.name === "") return;
        const file = section.location.file;
        try {
            await p.open(file);
        } catch (err) {
            showToast(`Couldn't open ${file}: ${errorText(err)}`);
            return;
        }
        const view = await viewFor(file);
        if (!view) return;
        const same = card?.id === section.id && !!narrowed(view.state);
        if (!same) {
            card = { id: section.id, file };
            for (const [path, other] of views) {
                if (path !== file && narrowed(other.state)) other.dispatch({ effects: setNarrow.of(null) });
            }
            const lines: [number, number, boolean] = [section.range.start.line, section.range.end.line, !!section.detail];
            let range = narrowRange(view.state, ...lines);
            if (!range) {
                // A header on the file's last line, with nowhere to write under it
                view.dispatch({ changes: { from: view.state.doc.length, insert: "\n" } });
                range = narrowRange(view.state, ...lines)!;
            }
            view.dispatch({ effects: setNarrow.of(range), selection: { anchor: range.from } });
        }
        const target = at ?? (node.kind === "passage" ? node.location.range.start : undefined);
        if (target) {
            const anchor = toOffset(view.state.doc, target);
            view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "start", yMargin: 24 }) });
        } else if (!same) {
            view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "start" }) });
        }
        if (focus) {
            // Once the card's on screen: an editor that's hidden can't take the focus
            await tick();
            view.focus();
        }
    }

    // The toolbar's Add, while a section's being written in the card. In the script, it adds an
    // empty header to type a name in, which the card doesn't show. So here, text that's selected
    // becomes a link to a new section or passage of that name, as in the script, and otherwise
    // the name's asked for on the map.
    async function addFromCard(kind: "section" | "passage") {
        const graph = storyGraph;
        const section = cardNode;
        const view = card ? views.get(card.file) : undefined;
        if (!p || !graph || !section || !view) return;
        const selection = view.state.selection.main;
        const name = view.state.sliceDoc(selection.from, selection.to).replace(/[[\]\n]/g, "").trim();
        if (!name) {
            if (kind === "section") mapPanel?.nameSection(section);
            else mapPanel?.namePassage(section);
            return;
        }
        const problem = kind === "section" ? checkSectionName(name, graph) : checkPassageName(name, section.name, graph);
        if (problem) {
            showToast(problem, "info");
            return;
        }
        const file = section.location.file;
        const doc = view.state.doc;
        const link: WorkspaceEdit = {
            [file]: [{ range: { start: toPosition(doc, selection.from), end: toPosition(doc, selection.to) }, newText: kind === "section" ? `[[${name}]]` : `[${name}]` }],
        };
        try {
            const edit = kind === "section"
                ? await linkThenHeader(link, placeNewSection(graph, { from: section, file }), `[[${name}]]:`)
                : await linkThenHeader(link, placeNewPassage(section), `[${name}]:`);
            await applyMapEdit(edit);
        } catch (err) {
            showToast(`Couldn't add the ${kind}: ${errorText(err)}`);
        }
    }

    // After a change made from the map, what the card shows is worked out again from the story:
    // a new section added straight after the one being written isn't part of it, though it's
    // where the card's text ended.
    let cardResync = false;
    function resyncCard(graph: StoryGraph) {
        const section = card && graph.nodes.find(n => n.id === card?.id);
        const view = card ? views.get(card.file) : undefined;
        if (!section || !view || !narrowed(view.state)) return;
        const range = narrowRange(view.state, section.range.start.line, section.range.end.line, !!section.detail);
        const now = narrowed(view.state);
        if (range && (range.from !== now?.from || range.to !== now.to)) view.dispatch({ effects: setNarrow.of(range) });
    }

    function closeCard() {
        if (!card) return;
        card = null;
        for (const view of views.values()) {
            if (narrowed(view.state)) view.dispatch({ effects: setNarrow.of(null), scrollIntoView: true });
        }
    }

    // Leaving the full-screen map shows the whole script again
    $effect(() => {
        if (card && !(mapOpen && mapMaximized && !isNarrow.current)) untrack(closeCard);
    });

    // With the map full screen, going somewhere in the story (a link's definition, a problem, a
    // search result) shows that section in the card, as the script's hidden. Says whether it did.
    async function goToInCard(location: Location, focus: boolean): Promise<boolean> {
        if (!(mapOpen && mapMaximized && !isNarrow.current) || !storyGraph) return false;
        const node = isSquiffyFile(location.file) ? nodeAtLine(storyGraph, location.file, location.range.start.line) : undefined;
        if (!node) {
            // Not in a section that can be shown on its own, so back to the script
            closeCard();
            mapMaximized = false;
            return false;
        }
        await openCard(node, focus, location.range.start);
        mapPanel?.focusNode(node.id, false, false);
        return true;
    }

    // The toolbar's Code, Code + Map and Map
    function setView(view: "code" | "split" | "map") {
        mapOpen = view !== "code";
        mapMaximized = view === "map";
    }

    // On a narrow screen, the map in place of the script, or back
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
    // Without a squiffy.json, whether the author said no to adding one
    let declinedProjectFile = false;
    function savePositions(next: MapPositions) {
        const current = p;
        if (!current) return;
        const empty = !Object.keys(next.sections).length && !Object.keys(next.passages).length;
        if (!current.projectFile && (empty || declinedProjectFile || current.projectText !== null)) {
            // Nothing worth adding a squiffy.json for, the author doesn't want one, or there's one
            // that can't be read
            sessionPositions = next;
            if (current.projectText !== null && !empty) showToast("squiffy.json couldn't be read, so the map's positions weren't saved. Fix it, then try again.");
            return;
        }
        // Shown straight away, while squiffy.json is written
        if (!current.projectFile) sessionPositions = next;
        positionsQueue = positionsQueue.then(async () => {
            try {
                if (!current.projectFile && !(await addProjectFile(current, "to save where you put things on the map"))) {
                    declinedProjectFile = true;
                    showToast("Where you put things on the map is saved in squiffy.json, so without one it'll be forgotten when you close the story.", "info", 8000);
                    return;
                }
                if (!(await current.setMapPositions(next))) showToast("squiffy.json couldn't be read, so the map's positions weren't saved. Fix it, then try again.");
            } catch (err) {
                showToast(`Couldn't save the map: ${errorText(err)}`);
            }
        });
    }

    // Adds a squiffy.json to keep the map's positions in. It makes the folder one story, so any
    // other .squiffy files in the folder that aren't part of the story now are excluded, and the
    // story stays as it was. If the story has an error, which files are part of it isn't certain,
    // so the author is asked instead. Says whether there's a squiffy.json now.
    // The .css and .js files that are part of the story now, for a new squiffy.json to keep
    async function currentPageFiles(): Promise<string[]> {
        const c = client;
        if (!c) return [];
        await syncOpenFiles();
        return (await c.call("getStoryFiles")).pageFiles;
    }

    // Adds squiffy.json, for something only it can keep (`why`, as "to save ..."), and says so
    async function addProjectFile(current: NonNullable<typeof p>, why: string): Promise<boolean> {
        const c = client;
        if (!c) return false;
        await syncOpenFiles();
        const { files, pageFiles, complete } = await c.call("getStoryFiles");
        if (!complete) return (await offerProjectFile(current, { main: current.mainFile, pageFiles })) === "created";
        const inStory = new Set(files);
        const exclude = current.files.map(f => f.path).filter(path => isSquiffyFile(path) && path !== current.mainFile && !inStory.has(path));
        const conversion = await current.createProjectFile(current.mainFile, exclude, pageFiles);
        const converted = setterConversionMessage(conversion);
        showToast(`Added ${PROJECT_FILENAME}, ${why}.${exclude.length ? ` It leaves out the .squiffy files that aren't part of this story.` : ""}${converted ? ` ${converted}` : ""}`, "info", converted ? 12000 : 8000);
        return true;
    }

    // Shows a location in the editor, opening its file, without taking the focus from the map
    async function showLocation(location: Location) {
        if (!p) return;
        if (await goToInCard(location, false)) return;
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
            closeCard();
            mapMaximized = false;
            void goToLocation(location);
        } else {
            void showLocation(location);
        }
    }

    // A link's line on the map shows where the link is: with the map full screen, in the card,
    // which keeps the map on screen (showLocation falls back to the script if the link isn't in a
    // section the card can show)
    function goFromEdge(location: Location) {
        if (mapMaximized && !isNarrow.current) void showLocation(location);
        else goFromMap(location, false);
    }

    // Where a new link from a section or passage goes: at the cursor, if it's in there, or else
    // after the last thing in it
    function linkEdit(from: GraphNode, text: string): WorkspaceEdit {
        const file = from.location.file;
        const view = views.get(file);
        // Only where the author can see the cursor: with the map full screen, the script's hidden,
        // unless that section's being written in the card
        const cursorSeen = !mapMaximized || cardShown;
        if (view && cursorSeen && p?.activePath === file && storyGraph) {
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

    // A file's text as it is now: in its editor, if it's open
    const currentText = async (file: string) => p?.fileAt(file)?.text ?? await p!.fs.readText(file);

    // A new section's or passage's header, somewhere in a file (see map-edits)
    async function headerEdit(place: Place, header: string): Promise<WorkspaceEdit> {
        return { [place.file]: [insertHeaderEdit(await currentText(place.file), place.afterLine, header)] };
    }

    // A link, with the header of the new section or passage it links to, which goes after it
    async function linkThenHeader(link: WorkspaceEdit, place: Place, header: string): Promise<WorkspaceEdit> {
        const edit = link[place.file]?.[0];
        if (!edit) return mergeEdits(link, await headerEdit(place, header));
        return mergeEdits({}, { [place.file]: linkThenHeaderEdits(await currentText(place.file), edit, place.afterLine, header) });
    }

    // Two edits as one. Text added at the same place goes in the order given, `a`'s first.
    function mergeEdits(a: WorkspaceEdit, b: WorkspaceEdit): WorkspaceEdit {
        const merged: WorkspaceEdit = { ...a };
        for (const [file, edits] of Object.entries(b)) {
            const list = [...merged[file] ?? []];
            for (const edit of edits) {
                const same = list.findIndex(e => e.range.start.line === edit.range.start.line && e.range.start.character === edit.range.start.character
                    && e.range.end.line === e.range.start.line && e.range.end.character === e.range.start.character
                    && edit.range.end.line === edit.range.start.line && edit.range.end.character === edit.range.start.character);
                if (same >= 0) list[same] = { range: list[same].range, newText: list[same].newText + edit.newText };
                else list.push(edit);
            }
            merged[file] = list;
        }
        return merged;
    }

    // Changes made from the map: the files whose script changed, and any change to where boxes
    // are. Undoing from the map undoes them where they were made, which may not be the file
    // that's open.
    interface MapChange {
        files: string[];
        positions?: { before: MapPositions; after: MapPositions };
    }
    let mapUndo: MapChange[] = [];
    let mapRedo: MapChange[] = [];

    function recordMapChange(change: MapChange) {
        mapUndo.push(change);
        mapRedo = [];
    }

    // Moves boxes, as a change that can be undone
    function moveOnMap(next: MapPositions) {
        recordMapChange({ files: [], positions: { before: mapPositions ?? emptyPositions(), after: next } });
        savePositions(next);
    }

    // Opens the files an edit changes, so that it goes into their editors' undo histories. The
    // file that's open stays in front.
    async function openForEdit(files: string[]) {
        const current = p;
        const closed = files.filter(file => !views.has(file));
        if (!current || !closed.length) return;
        const active = current.activePath;
        for (const file of closed) {
            try {
                await current.open(file);
                await viewFor(file);
            } catch {
                // It's changed on disk instead
            }
        }
        if (active && current.fileAt(active)) current.activePath = active;
    }

    async function applyMapEdit(edit: WorkspaceEdit, positions?: MapChange["positions"]) {
        cardResync = true;
        const files = Object.keys(edit);
        await openForEdit(files);
        recordMapChange({ files: files.filter(file => views.has(file)), positions });
        if (positions) savePositions(positions.after);
        await applyEdits(edit);
    }

    // Undo or redo from the map: the last change made from it, or else the open file's last change
    function undoFromMap(isRedo: boolean) {
        const [stack, other] = isRedo ? [mapRedo, mapUndo] : [mapUndo, mapRedo];
        const change = stack.pop();
        if (!change) {
            const view = p?.activePath ? views.get(p.activePath) : undefined;
            if (view) (isRedo ? redo : undo)(view);
            return;
        }
        for (const file of change.files) {
            const view = views.get(file);
            if (view) (isRedo ? redo : undo)(view);
        }
        if (change.positions) {
            const { before, after } = change.positions;
            savePositions(isRedo ? revertPositions(mapPositions, before, after) : revertPositions(mapPositions, after, before));
        }
        other.push(change);
    }

    // Adds a section, where it was asked for on the map, in the same file as the section it's
    // linked from or near (or the file that's open, or the main file). In the script, it goes
    // after that section, or the sections it already leads to (see placeNewSection).
    //
    // `from` is the section or passage it's for: the one a link was dragged from (so a link to the
    // new section is added there, unless `link` is false, for a link that's there already).
    // `at` is where its box goes, if the author chose.
    async function createSectionFromMap(name: string, where: { at?: Point; near?: GraphNode; from?: GraphNode; link?: boolean }) {
        const graph = storyGraph;
        if (!p || !graph) return;
        const { at, near, from } = where;
        const file = from?.location.file ?? near?.location.file ?? (isSquiffyFile(p.activePath) ? p.activePath : p.mainFile);
        try {
            const place = placeNewSection(graph, { from, near, file });
            const edit = from && where.link !== false
                ? await linkThenHeader(linkEdit(from, `[[${name}]]`), place, `[[${name}]]:`)
                : await headerEdit(place, `[[${name}]]:`);
            selectWhenReady = `section:${name}`;
            await applyMapEdit(edit, at && {
                before: mapPositions ?? emptyPositions(),
                after: withPosition(mapPositions, new Map(), { kind: "section", name }, at),
            });
        } catch (err) {
            showToast(`Couldn't add the section: ${errorText(err)}`);
        }
    }

    // Adds a passage to a section, with a link to it from the section (or from the passage it
    // was added from), so it can be reached (unless `link` is false, for a link that's there
    // already)
    async function addPassageFromMap(from: GraphNode, name: string, link = true) {
        const graph = storyGraph;
        if (!p || !graph) return;
        const sectionName = from.kind === "section" ? from.name : from.section!;
        const section = graph.nodes.find(n => n.kind === "section" && n.name === sectionName);
        if (!section) return;
        try {
            const place = placeNewPassage(section);
            const edit = link ? await linkThenHeader(linkEdit(from, `[${name}]`), place, `[${name}]:`) : await headerEdit(place, `[${name}]:`);
            selectWhenReady = `passage:${sectionName}/${name}`;
            await applyMapEdit(edit);
        } catch (err) {
            showToast(`Couldn't add the passage: ${errorText(err)}`);
        }
    }

    async function deleteFromMap(nodes: GraphNode[]) {
        const graph = storyGraph;
        if (!p || !graph) return;
        // The text of every file with links in it, to find the links on lines of their own
        const texts = new Map<string, string>();
        for (const file of new Set(graph.edges.map(e => e.location.file))) {
            try {
                texts.set(file, await currentText(file));
            } catch {
                // Its links are left as they are
            }
        }
        const plan = planDeletion(graph, nodes, texts);
        if (!p || !plan) return;
        if (!(await confirmDialog(deletionMessage(plan), { confirmLabel: "Delete", danger: true })) || !p) return;
        try {
            const edit: WorkspaceEdit = {};
            for (const [file, ranges] of plan.ranges) edit[file] = deleteLinesEdits(await currentText(file), ranges);
            await applyMapEdit(edit);
        } catch (err) {
            showToast(`Couldn't delete: ${errorText(err)}`);
        }
    }

    // Makes the story start at a section, with @start in the main file
    async function startFromMap(node: GraphNode) {
        if (!p) return;
        const file = p.mainFile;
        try {
            await applyMapEdit({ [file]: [startEdit(await currentText(file), node.name)] });
        } catch (err) {
            showToast(`Couldn't change where the story starts: ${errorText(err)}`);
        }
    }

    async function linkFromMap(from: GraphNode, to: GraphNode | null, at: Point, name?: string) {
        if (!to) {
            if (name) await createSectionFromMap(name, { at, from });
            return;
        }
        const link = linkTo(from, to);
        if ("error" in link) {
            showToast(link.error, "info");
            return;
        }
        await applyMapEdit(linkEdit(from, link.text));
    }

    // Renames a section or passage everywhere it's used. With a name (typed on the map), says why
    // it can't be used, if it can't; without one, asks for it.
    async function renameFromMap(node: GraphNode, name?: string): Promise<string | undefined> {
        const c = client;
        if (!c || node.detail) return undefined;
        const asked = name === undefined;
        name ??= (await promptDialog(`Rename the ${node.kind} "${node.name}" to:`, node.name, "Rename"))?.trim();
        if (!name || name === node.name) return undefined;
        await syncOpenFiles();
        const result = await c.call("getRenameEdits", node.location.file, node.location.range.start, name);
        if (!result) return undefined;
        if ("error" in result) {
            if (asked) showToast(result.error, "info");
            return result.error;
        }
        await applyMapEdit(result.edit);
        return undefined;
    }

    async function relayoutMap(): Promise<boolean> {
        const saved = mapPositions && (Object.keys(mapPositions.sections).length || Object.keys(mapPositions.passages).length);
        if (saved) {
            if (!(await confirmDialog("Lay out the map again? Everything you've moved by hand goes back to where the map puts it.", { confirmLabel: "Lay out again" }))) return false;
            moveOnMap(emptyPositions());
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

    // Saves the published story as a file, as it is in the editor now. Resolves to what went
    // wrong, if anything did.
    async function handleExport(kind: ExportKind): Promise<string | null> {
        const current = p;
        const c = client;
        if (!current || !c) return "The story isn't open.";
        try {
            await syncOpenFiles();
            const { fileName, saveBlob, storyAssets } = await import("#lib/export.js");
            const result = await c.call("exportStory", kind, kind === "js" ? {} : await storyAssets(current));
            if (!result.success) return `The story can't be published until this is fixed: ${result.errors[0]}`;
            if (kind === "zip" && result.zip) {
                saveBlob(new Blob([result.zip as BlobPart], { type: "application/zip" }), fileName(current.displayName, " (web).zip"));
            } else if (kind === "html") {
                saveBlob(new Blob([result.files["index.html"]], { type: "text/html" }), fileName(current.displayName, ".html"));
            } else if (kind === "js") {
                saveBlob(new Blob([result.files["story.js"]], { type: "text/javascript" }), "story.js");
            }
            return null;
        } catch (err) {
            return `Couldn't publish the story: ${errorText(err)}`;
        }
    }

    // The published story as a zip, to upload to textadventures.co.uk, or why it can't be made.
    // The story needs a squiffy.json first: its ID is how textadventures.co.uk knows, next time,
    // that this is an update to the same story.
    async function preparePublishOnline(): Promise<{ zip: Uint8Array; filename: string } | { error: string }> {
        const current = p;
        const c = client;
        if (!current || !c) return { error: "The story isn't open." };
        try {
            if (current.projectText !== null && !current.projectFile) {
                return { error: `${PROJECT_FILENAME} couldn't be read. Fix it, then try again.` };
            }
            if (!current.projectFile && !(await addProjectFile(current, "so textadventures.co.uk knows which story this is"))) {
                return { error: `The story needs a ${PROJECT_FILENAME} project file to be published this way.` };
            }
            await syncOpenFiles();
            const { fileName, storyAssets } = await import("#lib/export.js");
            const result = await c.call("exportStory", "zip", await storyAssets(current));
            if (!result.success) return { error: `The story can't be published until this is fixed: ${result.errors[0]}` };
            if (!result.zip) return { error: "Couldn't publish the story." };
            return { zip: result.zip, filename: fileName(current.displayName, ".zip") };
        } catch (err) {
            return { error: `Couldn't publish the story: ${errorText(err)}` };
        }
    }

    // The story as a link, which has the story in it (#lib/share-link.ts), or why it can't be one
    async function prepareStoryLink(): Promise<StoryLink | { error: string }> {
        const current = p;
        const c = client;
        if (!current || !c) return { error: "The story isn't open." };
        try {
            await syncOpenFiles();
            // A story that doesn't compile can't be played from its link either
            const compiled = await c.call("exportStory", "js", {});
            if (!compiled.success) return { error: `The story can't be shared until this is fixed: ${compiled.errors[0]}` };
            const { projectContents } = await import("#lib/export.js");
            const { createStoryLink } = await import("#lib/share-link.js");
            return createStoryLink(await projectContents(current), current.mainFile, __APP_VERSION__);
        } catch (err) {
            return { error: `Couldn't make the link: ${errorText(err)}` };
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
            await current.resolveBackupReminder();
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

    // A new file is part of the story straight away. With a squiffy.json, that's automatic.
    // Without one, for a .squiffy file the editor offers to add one, or else @imports it from the
    // main file, and it @imports a stylesheet or script (#198).
    async function handleNewFile(kind: NewFileKind) {
        if (!p) return;
        const name = await promptDialog(`New ${NEW_FILE_KINDS[kind].noun} name:`, NEW_FILE_KINDS[kind].name, "Create");
        if (!name) return;
        const path = joinPath(dirname(p.mainFile), name.trim());
        if (!validPath(path)) return;
        const squiffy = isSquiffyFile(path);
        try {
            if (await p.fs.exists(path)) throw new Error(`There's already a file called ${path}.`);
            let offer: ProjectOffer | null = null;
            if (squiffy && !p.projectFile && p.projectText === null) {
                offer = await offerProjectFile(p, { main: p.mainFile, adding: path, pageFiles: await currentPageFiles() });
                if (offer === "cancelled") return;
            }
            await p.createFile(path, newFileText(path));
            if (offer === "declined" || (offer === null && !p.projectFile && needsImport(path))) await addImport(storyPath(p, path));
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

    // Takes "@import path" out of the main file, if it's there
    async function removeImport(path: string) {
        if (!p) return;
        const view = views.get(p.mainFile);
        const text = view ? view.state.doc.toString() : await p.fs.readText(p.mainFile);
        const match = new RegExp(`^@import[ \\t]+${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*(\\r?\\n|$)`, "m").exec(text);
        if (!match) return;
        if (view) {
            view.dispatch({ changes: { from: match.index, to: match.index + match[0].length } });
        } else {
            await p.fs.write(p.mainFile, text.slice(0, match.index) + text.slice(match.index + match[0].length));
            p.onFileChanged?.(p.mainFile);
        }
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
                if ((await offerProjectFile(p, { main: path, pageFiles: await currentPageFiles() })) !== "declined") return;
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
    function handleSplitterPointerDown(e: PointerEvent, panel: "sidebar" | "preview" | "map" | "card") {
        if (e.button !== 0) return;
        e.preventDefault();
        const splitter = e.currentTarget as HTMLElement;
        const startX = e.clientX;
        const startWidth = panel === "sidebar" ? sidebarWidth : panel === "map" ? mapWidth : panel === "card" ? cardWidth : previewWidth;
        const [min, max] = panel === "sidebar" ? SIDEBAR_LIMITS : panel === "map" ? MAP_LIMITS : panel === "card" ? [CARD_LIMITS[0], cardMaxWidth()] : PREVIEW_LIMITS;
        splitter.setPointerCapture(e.pointerId);
        document.body.classList.add("splitter-dragging");

        function onMove(moveEvent: PointerEvent) {
            const delta = moveEvent.clientX - startX;
            const next = Math.min(max, Math.max(min, startWidth + (panel === "sidebar" ? delta : -delta)));
            if (panel === "sidebar") sidebarWidth = next;
            else if (panel === "map") mapWidth = next;
            else if (panel === "card") cardWidthChosen = next;
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
            {problemCounts}
            {problemsOpen}
            ontoggleproblems={() => void toggleProblems()}
            onfindinfiles={() => void openFindInFiles()}
            ontogglemap={toggleMap}
            view={!mapOpen ? "code" : mapMaximized ? "map" : "split"}
            onview={setView}
            onrun={fromCursor => runPreview(fromCursor)}
            onassets={() => { assetsOpen = true; }}
            onfonts={() => { fontsOpen = true; }}
            onpublish={() => { publishOpen = true; }}
            ondownloadproject={handleDownloadProject}
            oncommand={command => { const v = activeView(); if (v) runCommand(v, command); }}
            onadd={kind => {
                const v = activeView();
                if (cardShown) void addFromCard(kind);
                else if (v && isSquiffyFile(p.activePath)) addSectionOrPassage(v, kind, symbols);
            }}
            onsnippet={content => { const v = activeView(); if (v) insertSnippet(v, content); }}
            {snippets}
            onabout={() => { aboutOpen = true; }}
            onplaytab={handlePlayInTab}
        />
        <BackupBanner ondownload={handleDownloadProject} />
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
            <!-- The script and the map, with the Problems, Find in Files and References panels
                 below both, so they're there with the map full screen too -->
            <div class="flex-1 min-w-0 flex flex-col {isNarrow.current && narrowPane !== "editor" && narrowPane !== "map" ? "hidden" : ""}">
            <div class="flex-1 min-h-0 flex">
            <!-- Kept mounted (hidden, not removed) on a narrow screen so the cursor and undo
                 history survive opening the sidebar or the preview -->
            <div
                id="editor"
                style={cardShown ? `position: fixed; top: ${mapArea.top + 8}px; left: ${mapArea.right - cardWidth - 8}px; width: ${cardWidth}px; height: ${Math.max(mapArea.height - 16, 0)}px;` : undefined}
                class="min-w-0 flex flex-col {cardShown ? "z-10 overflow-hidden rounded-md border border-surface-200-800 bg-surface-50-950 shadow-xl" : "flex-1"} {(isNarrow.current && narrowPane !== "editor") || (!isNarrow.current && mapOpen && mapMaximized && !cardShown) ? "hidden" : ""}"
            >
                {#if cardShown}
                    <!-- Its left edge, dragged to make it wider or narrower -->
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize the section"
                        class="splitter card-splitter"
                        onpointerdown={e => handleSplitterPointerDown(e, "card")}
                    ></div>
                {/if}
                {#if cardShown && cardNode}
                    <!-- The section being written from the map, in place of the tabs -->
                    <header class="flex items-center gap-0.5 px-2 py-1 border-b border-surface-200-800 bg-surface-50-950">
                        <h2 class="flex-1 min-w-0 truncate pl-1 text-sm font-semibold" title={cardNode.detail ?? cardNode.name}>{cardNode.detail ?? cardNode.name}</h2>
                        {#if !cardNode.detail}
                            <button type="button" class="btn-icon btn-icon-sm" title="Rename" aria-label="Rename" onclick={() => void renameFromMap(cardNode)}><Pencil size={14} /></button>
                        {/if}
                        <button type="button" class="btn-icon btn-icon-sm" title="Run from here" aria-label="Run from here" onclick={() => void runPreview(false, { section: cardNode.name })}><Play size={14} /></button>
                        <button type="button" class="btn-icon btn-icon-sm" title="Show in the whole script" aria-label="Show in the whole script" onclick={() => goFromMap(cardNode.location, true)}><Code size={14} /></button>
                        <button type="button" class="btn-icon btn-icon-sm" title="Close" aria-label="Close" onclick={() => { closeCard(); mapPanel?.focus(); }}><X size={14} /></button>
                    </header>
                {:else}
                    <EditorTabs project={p} />
                {/if}
                <!-- One editor per open file, so each keeps its own cursor and undo history -->
                {#each p.openFiles as file (file.path)}
                    <div class="flex-1 min-h-0 flex flex-col {file.path === p.activePath ? "" : "hidden"}">
                        <DiskChangeBar {file} onclose={() => void p.close(file.path)} />
                        <div class="flex-1 min-h-0">
                            <CodeEditor
                                value={file.text}
                                label={file.path}
                                extensions={extensionsFor(file.path)}
                                onChange={text => file.setText(text)}
                                onSave={() => void p.save()}
                                onCursor={offset => handleCursor(file.path, offset)}
                                onView={v => { if (v) views.set(file.path, v); }}
                                onContextMenu={handleEditorContextMenu}
                            />
                        </div>
                    </div>
                {:else}
                    <p class="flex-1 p-6 text-sm text-surface-600-400">Open a file from the list on the left.</p>
                {/each}
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
                    card={cardShown ? card?.id ?? null : null}
                    {cardWidth}
                    onarea={rect => { mapArea = rect; }}
                    onedit={(node, focus) => void openCard(node, focus)}
                    width={isNarrow.current || mapMaximized ? undefined : mapWidth}
                    ongoto={(node, focus) => { const location = node.graphNode?.location; if (location) goFromMap(location, focus); }}
                    ongotoedge={(edge: StoryMapEdge) => { const location = edge.edges[0]?.location ?? edge.location; if (location) goFromEdge(location); }}
                    onmove={moves => {
                        const keys = storyGraph ? sectionKeys(storyGraph) : new Map<string, string>();
                        moveOnMap(moves.reduce((positions, { node, at }) => withPosition(positions, keys, node, at), mapPositions ?? emptyPositions()));
                    }}
                    onlink={linkFromMap}
                    oncreate={(name, where) => void createSectionFromMap(name, where)}
                    onrename={renameFromMap}
                    onaddpassage={(from, name, link) => void addPassageFromMap(from, name, link)}
                    ondelete={nodes => void deleteFromMap(nodes)}
                    onstart={node => void startFromMap(node)}
                    onundo={undoFromMap}
                    onrun={node => void runPreview(false, node.kind === "section" ? { section: node.name } : { section: node.section!, passage: node.name })}
                    onrelayout={relayoutMap}
                    onclose={() => { mapOpen = false; mapMaximized = false; narrowPane = "editor"; }}
                />
            {/if}
            </div>
                {#if problemsOpen}
                    <ProblemsPanel
                        bind:this={problemsPanel}
                        bind:height={problemsHeight}
                        {problems}
                        counts={problemCounts}
                        onselect={goToProblem}
                        onfix={fix => void applyFix(fix)}
                        onclose={() => { problemsOpen = false; focusWork(); }}
                    />
                {/if}
                {#if findOpen}
                    <FindInFilesPanel
                        bind:this={findPanel}
                        bind:spec={findSpec}
                        bind:height={findHeight}
                        bind:replace={findReplace}
                        bind:replaceOpen={findReplaceOpen}
                        onreplace={(file, match) => void replaceMatch(file, match)}
                        onreplaceall={() => void replaceAllInFiles()}
                        results={findResults}
                        invalid={findInvalid}
                        onselect={goToMatch}
                        onclose={closeFindInFiles}
                    />
                {/if}
                {#if references}
                    <ReferencesPanel
                        name={references.name}
                        locations={references.locations}
                        textOf={file => p.fileAt(file)?.text}
                        onselect={goToLocation}
                        onclose={() => { references = null; focusWork(); }}
                    />
                {/if}
            </div>
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
                        sections={previewSections}
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

    {#if editorMenu}
        <ContextMenu
            x={editorMenu.x}
            y={editorMenu.y}
            keyboard={editorMenu.keyboard}
            items={editorMenu.items}
            onclose={closeEditorMenu}
        />
    {/if}

    {#if aboutOpen}
        <AboutModal onclose={() => { aboutOpen = false; }} />
    {/if}

    {#if assetsOpen}
        <AssetManagerModal project={p} oninsert={insertAsset} oncancel={() => { assetsOpen = false; }} />
    {/if}

    {#if detailsOpen}
        <StoryDetailsModal
            project={p}
            onaddprojectfile={() => p ? addProjectFile(p, "to save the story's details") : Promise.resolve(false)}
            onclose={() => { detailsOpen = false; publishOpen = detailsFromPublish; detailsFromPublish = false; }}
        />
    {/if}

    {#if publishOpen}
        <PublishModal
            project={p}
            {problemCounts}
            onexport={handleExport}
            prepare={preparePublishOnline}
            preparelink={prepareStoryLink}
            ondetails={() => { publishOpen = false; detailsFromPublish = true; detailsOpen = true; }}
            onproblems={() => { publishOpen = false; if (!problemsOpen) void toggleProblems(); }}
            onclose={() => { publishOpen = false; }}
        />
    {/if}

    {#if fontsOpen}
        <!-- Without a squiffy.json, a font's stylesheet is only part of the story if the main file @imports it -->
        <FontsModal
            project={p}
            onadded={css => { if (p && !p.projectFile && needsImport(css)) void addImport(storyPath(p, css)); }}
            onremoving={css => { if (p && !p.projectFile) void removeImport(storyPath(p, css)); }}
            oncancel={() => { fontsOpen = false; }}
        />
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
    .card-splitter {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        z-index: 1;
    }
    :global(body.splitter-dragging) {
        cursor: col-resize;
        user-select: none;
    }
    :global(body.splitter-dragging iframe) {
        pointer-events: none;
    }
</style>

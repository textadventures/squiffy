<script lang="ts">
    // The editor: toolbar; files and outline; a tab and a code editor for each open file; and the
    // preview. Laid out like Quest Viva's edit page.
    import { onMount, tick } from "svelte";
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { EditorView } from "@codemirror/view";
    import type { Extension } from "@codemirror/state";
    import type { DocumentSymbol, Location, WorkspaceEdit } from "squiffy-compiler/language-service";
    import { basename, dirname, guessMimeType, joinPath, parsePath } from "@textadventures/project-fs";
    import { base } from "#lib/base-path.js";
    import { project, openDraft, downloadFile, storyPath } from "#lib/project.svelte.js";
    import { isAsset, isSquiffyFile, isTextFile } from "#lib/file-types.js";
    import { createLanguageClient, type LanguageClient } from "#lib/language/client.js";
    import { applyEditsToString, applyTextEdits, languageFeatures, toOffset, toPosition } from "#lib/language/codemirror.js";
    import { squiffyLanguage } from "#lib/squiffy-lang.js";
    import { isNarrow } from "#lib/layout.svelte.js";
    import { showToast } from "#lib/toast.js";
    import { confirmDialog, promptDialog } from "#lib/confirm.js";
    import Toolbar from "#components/Toolbar.svelte";
    import FilesPanel from "#components/FilesPanel.svelte";
    import OutlinePanel from "#components/OutlinePanel.svelte";
    import EditorTabs from "#components/EditorTabs.svelte";
    import CodeEditor from "#components/CodeEditor.svelte";
    import ReferencesPanel from "#components/ReferencesPanel.svelte";
    import PreviewPanel from "#components/PreviewPanel.svelte";
    import AssetManagerModal from "#components/AssetManagerModal.svelte";
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
    // Changes whenever an asset is added, changed or deleted, so the preview gets it
    let assetsVersion = $state(0);

    let preview = $state<ReturnType<typeof PreviewPanel>>();
    let previewOpen = $state(false);

    // Session-only, as in Quest Viva
    let sidebarWidth = $state(240);
    let previewWidth = $state(420);
    const SIDEBAR_LIMITS = [160, 500] as const;
    const PREVIEW_LIMITS = [280, 900] as const;

    // On a narrow screen one pane shows at a time: the editor, the sidebar or the preview
    let narrowPane = $state<"editor" | "outline" | "preview">("editor");

    const activeView = () => (p ? views.get(p.activePath) : undefined);
    let symbols = $derived(p ? symbolsByPath[p.activePath] ?? [] : []);

    onMount(() => {
        void (async () => {
            const draftId = page.url.searchParams.get("draft");
            const current = project.current;
            const isOpen = current?.source.kind === "draft" && current.source.id === draftId;
            try {
                if (draftId && !isOpen) await openDraft(draftId);
            } catch (err) {
                showToast(`Couldn't open the draft: ${err instanceof Error ? err.message : String(err)}`);
            }
            // A folder can't be reopened from the URL, since the browser has to ask for it again
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
            void c.call("fileChanged", path);
            if (isAsset(path)) assetsVersion++;
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

    function extensionsFor(path: string): Extension[] {
        const c = client;
        const current = p;
        if (!c || !current || !isSquiffyFile(path)) return [];
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
    async function runPreview(fromCursor = false) {
        if (!p || !client) return;
        let startAt: { section: string; passage?: string } | undefined;
        const view = activeView();
        if (fromCursor && view && isSquiffyFile(p.activePath)) {
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

    // A new .squiffy file is @imported from the main file, so it's part of the story straight away
    async function handleNewFile() {
        if (!p) return;
        const name = await promptDialog("New file name:", "chapter.squiffy", "Create");
        if (!name) return;
        const path = joinPath(dirname(p.mainFile), name.trim());
        if (!validPath(path)) return;
        const squiffy = isSquiffyFile(path);
        try {
            await p.createFile(path, squiffy ? `[[${basename(path).replace(/\.squiffy$/i, "")}]]:\n\n` : "");
            if (squiffy) await addImport(storyPath(p, path));
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

    // Drags a splitter: the sidebar's is on its right, the preview's on its left
    function handleSplitterPointerDown(e: PointerEvent, panel: "sidebar" | "preview") {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = panel === "sidebar" ? sidebarWidth : previewWidth;
        const [min, max] = panel === "sidebar" ? SIDEBAR_LIMITS : PREVIEW_LIMITS;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        function onMove(moveEvent: PointerEvent) {
            const delta = moveEvent.clientX - startX;
            const next = Math.min(max, Math.max(min, startWidth + (panel === "sidebar" ? delta : -delta)));
            if (panel === "sidebar") sidebarWidth = next;
            else previewWidth = next;
        }
        function onUp() {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        }
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
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
            onrun={fromCursor => runPreview(fromCursor)}
            onassets={() => { assetsOpen = true; }}
            ondownloadproject={handleDownloadProject}
            onexport={handleExport}
        />
        <div class="flex flex-1 overflow-hidden">
            {#if !isNarrow.current || narrowPane === "outline"}
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
                            onopen={handleOpenFile}
                        />
                    </div>
                    <OutlinePanel
                        bind:this={outline}
                        {symbols}
                        {cursorLine}
                        onselect={goToSymbol}
                    />
                </div>
            {/if}
            {#if !isNarrow.current}
                <div
                    role="separator"
                    aria-orientation="vertical"
                    class="splitter"
                    onpointerdown={e => handleSplitterPointerDown(e, "sidebar")}
                ></div>
            {/if}
            <!-- Kept mounted (hidden, not removed) on a narrow screen so the cursor and undo
                 history survive opening the sidebar or the preview -->
            <div id="editor" class="flex-1 min-w-0 flex flex-col {isNarrow.current && narrowPane !== "editor" ? "hidden" : ""}">
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
                        onclose={() => { previewOpen = false; narrowPane = "editor"; }}
                        width={isNarrow.current ? undefined : previewWidth}
                    />
                </div>
            {/if}
        </div>
    </main>

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
</style>

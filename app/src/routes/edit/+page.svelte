<script lang="ts">
    // The editor: toolbar, outline, code editor and preview, laid out like Quest Viva's edit page.
    import { onMount, tick } from "svelte";
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { EditorView } from "@codemirror/view";
    import type { DocumentSymbol, Location, WorkspaceEdit } from "squiffy-compiler/language-service";
    import { base } from "#lib/base-path.js";
    import { project, openDraft } from "#lib/project.svelte.js";
    import { createLanguageClient, type LanguageClient } from "#lib/language/client.js";
    import { applyEditsToString, languageFeatures, toOffset, toPosition } from "#lib/language/codemirror.js";
    import { squiffyLanguage } from "#lib/squiffy-lang.js";
    import { isNarrow } from "#lib/layout.svelte.js";
    import { showToast } from "#lib/toast.js";
    import { promptDialog } from "#lib/confirm.js";
    import Toolbar from "#components/Toolbar.svelte";
    import OutlinePanel from "#components/OutlinePanel.svelte";
    import CodeEditor from "#components/CodeEditor.svelte";
    import ReferencesPanel from "#components/ReferencesPanel.svelte";
    import PreviewPanel from "#components/PreviewPanel.svelte";

    const p = $derived(project.current);

    let loading = $state(true);
    let symbols = $state<DocumentSymbol[]>([]);
    let cursorLine = $state(0);
    let view: EditorView | null = null;
    let outline = $state<ReturnType<typeof OutlinePanel>>();
    // Shift+F12's results, shown under the editor
    let references = $state<{ name: string; locations: Location[] } | null>(null);

    let preview = $state<ReturnType<typeof PreviewPanel>>();
    let previewOpen = $state(false);

    // Session-only, as in Quest Viva
    let outlineWidth = $state(240);
    let previewWidth = $state(420);
    const OUTLINE_LIMITS = [160, 500] as const;
    const PREVIEW_LIMITS = [280, 900] as const;

    // On a narrow screen one pane shows at a time: the editor, the outline or the preview
    let narrowPane = $state<"editor" | "outline" | "preview">("editor");

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
        client = c;
        return () => {
            c.dispose();
            client = null;
        };
    });

    let extensions = $derived.by(() => {
        if (!client || !p) return [];
        const current = p;
        return [
            squiffyLanguage,
            languageFeatures({
                client,
                path: current.mainFile,
                onSymbols: s => {
                    symbols = s;
                    current.setTitle(s.find(x => x.kind === "title")?.name ?? "");
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
    });

    // Moves the editor to a location. Only the main file is open for now: multi-file projects
    // come with #118.
    function goToLocation(location: Location) {
        if (!view || !p) return;
        if (location.file !== p.mainFile) {
            showToast(`That's in ${location.file}, which can't be opened yet.`, "info");
            return;
        }
        const anchor = toOffset(view.state.doc, location.range.start);
        const head = toOffset(view.state.doc, location.range.end);
        view.dispatch({ selection: { anchor, head }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
        view.focus();
    }

    // Edits to other files in the project, e.g. a rename that reaches into an @imported file
    async function applyEdits(edit: WorkspaceEdit) {
        if (!p || !client) return;
        for (const [file, edits] of Object.entries(edit)) {
            try {
                await p.fs.write(file, applyEditsToString(await p.fs.readText(file), edits));
                await client.call("fileChanged", file);
            } catch (err) {
                showToast(`Couldn't change ${file}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    // Compiles the story as it is in the editor now, for the preview
    async function compileStory() {
        if (!client || !p) return { success: false as const, errors: ["The story isn't open."] };
        await client.call("updateFile", p.mainFile, p.text);
        return client.call("compile");
    }

    // Runs the story in the preview: from the start, or from the section (and passage) the
    // cursor is in (#175)
    async function runPreview(fromCursor = false) {
        if (!p || !client) return;
        let startAt: { section: string; passage?: string } | undefined;
        if (fromCursor && view) {
            await client.call("updateFile", p.mainFile, p.text);
            startAt = await client.call("getSectionAt", p.mainFile, toPosition(view.state.doc, view.state.selection.main.head));
        }
        previewOpen = true;
        narrowPane = "preview";
        await tick();
        await preview?.run(startAt);
    }

    // Edits hot-update the running story, once typing pauses
    $effect(() => {
        void p?.text;
        if (!previewOpen) return;
        const timer = setTimeout(() => void preview?.update(), 600);
        return () => clearTimeout(timer);
    });

    // When the player clicks through to a section or passage, the editor follows, without taking
    // the focus from the preview
    function followPreview(section: string, passage?: string) {
        if (!view) return;
        const sectionSymbol = symbols.find(s => s.kind === "section" && s.name === section);
        const target = (passage && sectionSymbol?.children.find(c => c.name === passage)) || sectionSymbol;
        if (!target) return;
        const offset = toOffset(view.state.doc, target.selectionRange.start);
        view.dispatch({ selection: { anchor: offset }, effects: EditorView.scrollIntoView(offset, { y: "start", yMargin: 24 }) });
    }

    function goToSymbol(symbol: DocumentSymbol) {
        narrowPane = "editor";
        // On a narrow screen the editor is only now coming back, so wait for it
        requestAnimationFrame(() => {
            if (!view) return;
            const offset = toOffset(view.state.doc, symbol.selectionRange.start);
            view.dispatch({
                selection: { anchor: offset },
                effects: EditorView.scrollIntoView(offset, { y: "start", yMargin: 24 }),
            });
            view.focus();
        });
    }

    function handleCursor(offset: number) {
        if (view) cursorLine = view.state.doc.lineAt(offset).number - 1;
    }

    // Drags a splitter: the outline's is on its right, the preview's on its left
    function handleSplitterPointerDown(e: PointerEvent, panel: "outline" | "preview") {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = panel === "outline" ? outlineWidth : previewWidth;
        const [min, max] = panel === "outline" ? OUTLINE_LIMITS : PREVIEW_LIMITS;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        function onMove(moveEvent: PointerEvent) {
            const delta = moveEvent.clientX - startX;
            const next = Math.min(max, Math.max(min, startWidth + (panel === "outline" ? delta : -delta)));
            if (panel === "outline") outlineWidth = next;
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
        />
        <div class="flex flex-1 overflow-hidden">
            {#if !isNarrow.current || narrowPane === "outline"}
                <OutlinePanel
                    bind:this={outline}
                    {symbols}
                    {cursorLine}
                    onselect={goToSymbol}
                    width={isNarrow.current ? undefined : outlineWidth}
                />
            {/if}
            {#if !isNarrow.current}
                <div
                    role="separator"
                    aria-orientation="vertical"
                    class="splitter"
                    onpointerdown={e => handleSplitterPointerDown(e, "outline")}
                ></div>
            {/if}
            <!-- Kept mounted (hidden, not removed) on a narrow screen so the cursor and undo
                 history survive opening the outline or the preview -->
            <div id="editor" class="flex-1 min-w-0 flex flex-col {isNarrow.current && narrowPane !== "editor" ? "hidden" : ""}">
                <div class="flex-1 min-h-0">
                    <CodeEditor
                        value={p.text}
                        {extensions}
                        onChange={text => p.setText(text)}
                        onSave={() => void p.save()}
                        onCursor={handleCursor}
                        onView={v => { view = v; }}
                    />
                </div>
                {#if references}
                    <ReferencesPanel
                        name={references.name}
                        locations={references.locations}
                        textOf={file => (file === p.mainFile ? p.text : undefined)}
                        onselect={goToLocation}
                        onclose={() => { references = null; view?.focus(); }}
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
                        onNavigated={followPreview}
                        onclose={() => { previewOpen = false; narrowPane = "editor"; }}
                        width={isNarrow.current ? undefined : previewWidth}
                    />
                </div>
            {/if}
        </div>
    </main>
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

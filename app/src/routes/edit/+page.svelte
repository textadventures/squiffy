<script lang="ts">
    // The editor: toolbar, outline and code editor, laid out like Quest Viva's edit page.
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { EditorView } from "@codemirror/view";
    import type { DocumentSymbol } from "squiffy-compiler/language-service";
    import { base } from "#lib/base-path.js";
    import { project, openDraft } from "#lib/project.svelte.js";
    import { createLanguageClient, type LanguageClient } from "#lib/language/client.js";
    import { languageFeatures, toOffset } from "#lib/language/codemirror.js";
    import { squiffyLanguage } from "#lib/squiffy-lang.js";
    import { isNarrow } from "#lib/layout.svelte.js";
    import { showToast } from "#lib/toast.js";
    import Toolbar from "#components/Toolbar.svelte";
    import OutlinePanel from "#components/OutlinePanel.svelte";
    import CodeEditor from "#components/CodeEditor.svelte";

    const p = $derived(project.current);

    let loading = $state(true);
    let symbols = $state<DocumentSymbol[]>([]);
    let cursorLine = $state(0);
    let view: EditorView | null = null;

    // Session-only, as in Quest Viva
    let outlineWidth = $state(240);
    const OUTLINE_MIN_WIDTH = 160;
    const OUTLINE_MAX_WIDTH = 500;

    // On a narrow screen the outline replaces the editor while it's open
    let narrowOutline = $state(false);

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
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
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
            }),
        ];
    });

    function goToSymbol(symbol: DocumentSymbol) {
        narrowOutline = false;
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

    function handleSplitterPointerDown(e: PointerEvent) {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = outlineWidth;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        function onMove(moveEvent: PointerEvent) {
            const next = startWidth + (moveEvent.clientX - startX);
            outlineWidth = Math.min(OUTLINE_MAX_WIDTH, Math.max(OUTLINE_MIN_WIDTH, next));
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
        <Toolbar outlineOpen={narrowOutline} ontoggleoutline={() => { narrowOutline = !narrowOutline; }} />
        <div class="flex flex-1 overflow-hidden">
            {#if !isNarrow.current || narrowOutline}
                <OutlinePanel
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
                    class="w-1 shrink-0 cursor-col-resize hover:bg-primary-500/50 active:bg-primary-500/70 transition-colors"
                    onpointerdown={handleSplitterPointerDown}
                ></div>
            {/if}
            <!-- Kept mounted (hidden, not removed) on a narrow screen so the cursor and undo
                 history survive opening the outline -->
            <div id="editor" class="flex-1 min-w-0 {isNarrow.current && narrowOutline ? "hidden" : ""}">
                <CodeEditor
                    value={p.text}
                    {extensions}
                    onChange={text => p.setText(text)}
                    onSave={() => void p.save()}
                    onCursor={handleCursor}
                    onView={v => { view = v; }}
                />
            </div>
        </div>
    </main>
{/if}

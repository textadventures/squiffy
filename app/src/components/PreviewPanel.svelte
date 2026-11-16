<script lang="ts">
    // The story preview: squiffy-runtime's preview page in a sandboxed iframe (srcdoc, scripts
    // only, so the story can't reach the editor, its storage or its cookies), driven through
    // squiffy-runtime/preview-host. Edits hot-update the running story, keeping its state;
    // Restart starts it again from where it was last run from.
    import { onMount } from "svelte";
    import type { PreviewHost, StartAt } from "squiffy-runtime/preview-host";
    import type { CompiledStory } from "#lib/language/protocol.js";
    import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
    import ArrowLeft from "@lucide/svelte/icons/arrow-left";
    import X from "@lucide/svelte/icons/x";
    import TriangleAlert from "@lucide/svelte/icons/triangle-alert";

    interface Props {
        // Compiles the story as it is in the editor now
        compile: () => Promise<CompiledStory>;
        // A section or passage was shown because the player clicked a link (not on starting)
        onNavigated?: (section: string, passage?: string) => void;
        onclose: () => void;
        width?: number;
    }

    let { compile, onNavigated, onclose, width }: Props = $props();

    let iframe = $state<HTMLIFrameElement>();
    let host: PreviewHost | null = null;
    // Where the story was last run from, for Restart
    let startAt: StartAt | undefined;
    let running = $state(false);
    let canGoBack = $state(false);
    let compileErrors = $state<string[] | null>(null);
    let runtimeError = $state<string | null>(null);
    // Navigations while the story starts are where it starts, not the player clicking
    let following = false;
    let pendingRun: { startAt?: StartAt } | null = null;
    let pageStarted = false;
    // Updates are compiled one at a time, so an older compile can't land after a newer one
    let updateQueue: Promise<void> = Promise.resolve();

    onMount(() => {
        let disposed = false;
        void (async () => {
            const [{ previewHtml }, { createPreviewHost, iframeChannel, setUpPreviewFrame }] = await Promise.all([
                import("squiffy-runtime/preview-html"),
                import("squiffy-runtime/preview-host"),
            ]);
            if (disposed || !iframe) return;
            setUpPreviewFrame(iframe, previewHtml);
            host = createPreviewHost(iframeChannel(iframe), {
                // The first is the page starting, when a queued load is sent anyway. A later one
                // means the page reloaded and lost the story, so start it again. Loading twice
                // at the start could leave the page blank.
                onReady: () => {
                    if (pageStarted && running) void run(startAt);
                    pageStarted = true;
                },
                onLoaded: () => {
                    following = true;
                },
                onCanGoBackChanged: value => {
                    canGoBack = value;
                },
                onNavigated: (section, passage) => {
                    if (following) onNavigated?.(section, passage);
                },
                onRuntimeError: message => {
                    runtimeError = message;
                },
            });
            if (pendingRun) {
                const { startAt: at } = pendingRun;
                pendingRun = null;
                await run(at);
            }
        })();
        return () => {
            disposed = true;
            host?.dispose();
            host = null;
        };
    });

    // Starts the story, from the start or from a section
    export async function run(at?: StartAt) {
        if (!host) {
            pendingRun = { startAt: at };
            return;
        }
        startAt = at;
        const result = await compile();
        if (!result.success) {
            compileErrors = result.errors;
            return;
        }
        compileErrors = null;
        runtimeError = null;
        canGoBack = false;
        following = false;
        running = true;
        host.load({ js: result.js, css: result.css, scripts: result.scripts }, at ? { startAt: at } : {});
    }

    // Hot-updates the running story after an edit
    export function update() {
        updateQueue = updateQueue.then(async () => {
            if (!host || !running) return;
            const result = await compile();
            if (!result.success) {
                compileErrors = result.errors;
                return;
            }
            compileErrors = null;
            host.update(result.js);
        });
        return updateQueue;
    }
</script>

<section
    aria-label="Preview"
    class="flex flex-col shrink-0 overflow-hidden border-l border-surface-200-800 bg-surface-50-950 {width === undefined ? "flex-1" : ""}"
    style={width === undefined ? undefined : `width: ${width}px`}
>
    <header class="flex items-center gap-1 px-2 py-1 border-b border-surface-200-800">
        <h2 class="text-[11px] font-semibold text-surface-600-400 uppercase tracking-wide flex-1 pl-1">Preview</h2>
        <button type="button" class="btn-icon btn-icon-sm" title="Back" aria-label="Back" disabled={!canGoBack} onclick={() => host?.back()}><ArrowLeft size={14} /></button>
        <button type="button" class="btn-icon btn-icon-sm" title="Restart" aria-label="Restart" onclick={() => run(startAt)}><RotateCcw size={14} /></button>
        <button type="button" class="btn-icon btn-icon-sm" title="Close preview" aria-label="Close preview" onclick={onclose}><X size={14} /></button>
    </header>
    {#if compileErrors}
        <div role="alert" class="flex gap-2 px-3 py-2 text-xs bg-error-50-950 text-error-700-300 border-b border-surface-200-800">
            <TriangleAlert size={14} class="shrink-0 mt-0.5" />
            <div>
                <p class="font-semibold">{running ? "The preview isn't up to date: the story has an error." : "The story can't run: it has an error."}</p>
                {#each compileErrors as error, i (i)}
                    <p class="font-mono">{error}</p>
                {/each}
            </div>
        </div>
    {/if}
    {#if runtimeError}
        <div role="alert" class="flex gap-2 px-3 py-2 text-xs bg-warning-50-950 text-warning-700-300 border-b border-surface-200-800">
            <TriangleAlert size={14} class="shrink-0 mt-0.5" />
            <p class="flex-1 font-mono">{runtimeError}</p>
            <button type="button" class="btn-icon btn-icon-sm" aria-label="Dismiss" onclick={() => { runtimeError = null; }}><X size={12} /></button>
        </div>
    {/if}
    <!-- The story's own page, always light: its default stylesheet doesn't follow the editor's
         theme (#176 covers the game's CSS separately) -->
    <iframe bind:this={iframe} title="Story preview" class="flex-1 w-full bg-white"></iframe>
</section>

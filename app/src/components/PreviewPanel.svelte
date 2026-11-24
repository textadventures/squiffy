<script lang="ts">
    // The story preview: squiffy-runtime's preview page in a sandboxed iframe (srcdoc, scripts
    // only, so the story can't reach the editor, its storage or its cookies), driven through
    // squiffy-runtime/preview-host. Edits hot-update the running story, keeping its state;
    // Restart starts it again from where it was last run from. The story's images and other assets
    // are sent as Blobs, since a sandboxed frame can't load the editor's own blob: URLs (#307).
    import { onMount, tick } from "svelte";
    import type { PreviewHost, StartAt } from "squiffy-runtime/preview-host";
    import type { CompiledStory } from "#lib/language/protocol.js";
    import { get } from "svelte/store";
    import { theme } from "#lib/theme-store.js";
    import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
    import ArrowLeft from "@lucide/svelte/icons/arrow-left";
    import X from "@lucide/svelte/icons/x";
    import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
    import ChevronRight from "@lucide/svelte/icons/chevron-right";
    import Sun from "@lucide/svelte/icons/sun";
    import Moon from "@lucide/svelte/icons/moon";
    import Volume2 from "@lucide/svelte/icons/volume-2";
    import VolumeX from "@lucide/svelte/icons/volume-x";
    import Flag from "@lucide/svelte/icons/flag";
    import { findSections, type StartSection } from "#lib/start-sections.js";

    interface Props {
        // Compiles the story as it is in the editor now
        compile: () => Promise<CompiledStory>;
        // The story's assets, by their path from the main file's folder
        assets: () => Promise<Record<string, Blob>>;
        // Changes when assets are added, replaced or deleted, to send them again
        assetsVersion?: number;
        // The sections the Start at menu lists, as the story is in the editor now
        sections?: () => Promise<StartSection[]>;
        // A section or passage was shown because the player clicked a link (not on starting)
        onNavigated?: (section: string, passage?: string) => void;
        // Every section or passage the story shows, from the start, for the story map's trace
        onVisited?: (section: string, passage?: string) => void;
        // The story was started again, from the start or a section
        onStarted?: () => void;
        onclose: () => void;
        width?: number;
    }

    let { compile, assets, sections, assetsVersion = 0, onNavigated, onVisited, onStarted, onclose, width }: Props = $props();

    let iframe = $state<HTMLIFrameElement>();
    let host: PreviewHost | null = null;
    // Where the story was last run from, for Restart
    let startAt = $state<StartAt | undefined>();
    // The Start at menu: the story's sections, to run it from one of them, as on a story's page
    // served by the command-line tool. Sections marked @test, which set up a scene, come first.
    let startMenuOpen = $state(false);
    let startSectionList = $state<StartSection[]>([]);
    let startFind = $state("");
    let startFindInput = $state<HTMLInputElement>();
    let startFound = $derived(findSections(startSectionList, startFind));
    let startTests = $derived(startFound.filter(s => s.test));
    let startOthers = $derived(startFound.filter(s => !s.test));

    async function toggleStartMenu() {
        if (startMenuOpen) {
            startMenuOpen = false;
            return;
        }
        startSectionList = await sections?.() ?? [];
        startFind = "";
        startMenuOpen = true;
        await tick();
        startFindInput?.focus();
    }

    function startFrom(section: string) {
        startMenuOpen = false;
        void run({ section });
    }

    function startMenuKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.stopPropagation();
            startMenuOpen = false;
        } else if (e.key === "Enter" && e.target === startFindInput && startFound.length) {
            // Enter in the search box runs from the first section listed
            startFrom((startTests[0] ?? startOthers[0]).name);
        }
    }
    let running = $state(false);
    let canGoBack = $state(false);
    let compileErrors = $state<string[] | null>(null);
    let runtimeError = $state<string | null>(null);
    // The story's attributes as it sets them, as the 6.x editor's debugger logs them
    let attributes = $state<Record<string, unknown>>({});
    let attributesOpen = $state(false);
    // Navigations while the story starts are where it starts, not the player clicking
    let following = false;
    // Where the story last said it was
    let lastPlace = "";
    let pendingRun: { startAt?: StartAt } | null = null;
    let pageStarted = false;
    // The preview follows the editor's theme, but its own button can show it in the other mode, to
    // check a story's styles in both. That lasts until the editor's theme setting changes.
    // Whether the editor is dark now, from the class its theme puts on <html>
    let editorDark = $state(false);
    let themeOverride = $state<"light" | "dark" | null>(null);
    let previewDark = $derived(themeOverride ? themeOverride === "dark" : editorDark);
    // The story's CSS sets its own color-scheme, so the button would make no difference
    let themeFixed = $state(false);
    // The mute button, shown once the story names a sound file or plays one (#444)
    let usesSound = $state(false);
    let muted = $state(false);

    function toggleMuted() {
        muted = !muted;
        host?.setMuted(muted);
    }

    let themeTitle = $derived(themeFixed ? "This story's CSS sets its own colour scheme"
        : previewDark ? "Show the preview in light mode" : "Show the preview in dark mode");

    function toggleTheme() {
        if (themeFixed) return;
        const next = previewDark ? "light" : "dark";
        // Back to the editor's mode is back to following the editor
        themeOverride = next === (editorDark ? "dark" : "light") ? null : next;
        host?.setTheme(themeOverride ?? get(theme));
    }

    // Updates are compiled one at a time, so an older compile can't land after a newer one
    let updateQueue: Promise<void> = Promise.resolve();

    onMount(() => {
        let disposed = false;
        let disposeTheme: (() => void) | undefined;
        const root = document.documentElement;
        editorDark = root.classList.contains("dark");
        const themeObserver = new MutationObserver(() => { editorDark = root.classList.contains("dark"); });
        themeObserver.observe(root, { attributes: true, attributeFilter: ["class"] });
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
                onAttributeSet: (name, value) => {
                    attributes = { ...attributes, [name]: value };
                },
                onCanGoBackChanged: value => {
                    canGoBack = value;
                },
                // A hot update reports the section that's showing again, which mustn't move the
                // author's cursor, so only a move to another section or passage is followed
                onNavigated: (section, passage) => {
                    const place = `${section}\u0000${passage ?? ""}`;
                    if (place === lastPlace) return;
                    lastPlace = place;
                    onVisited?.(section, passage);
                    if (following) onNavigated?.(section, passage);
                },
                onThemeFixed: fixed => {
                    themeFixed = fixed;
                },
                onUsesSound: value => {
                    usesSound = value;
                },
                onRuntimeError: message => {
                    runtimeError = message;
                },
            });
            // The story follows the editor's Light, Dark or Match system setting, and changing that
            // setting undoes the preview's own light/dark button
            disposeTheme = theme.subscribe(value => {
                themeOverride = null;
                host?.setTheme(value);
            });
            if (pendingRun) {
                const { startAt: at } = pendingRun;
                pendingRun = null;
                await run(at);
            }
        })();
        return () => {
            disposed = true;
            disposeTheme?.();
            themeObserver.disconnect();
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
        attributes = {};
        canGoBack = false;
        following = false;
        lastPlace = "";
        running = true;
        onStarted?.();
        host.setAssets({ files: await assets() });
        host.load({ js: result.js, css: result.css, scripts: result.scripts }, at ? { startAt: at } : {});
    }

    // New or changed assets go to the running story; ones already on screen stay as they were
    let sentAssetsVersion = 0;
    $effect(() => {
        const version = assetsVersion;
        if (version === sentAssetsVersion) return;
        sentAssetsVersion = version;
        if (host && running) void assets().then(files => host?.setAssets({ files }));
    });

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
            // With the story's stylesheets, so a CSS change shows without a restart. Its scripts
            // can't be swapped into a running story, so those only change on Run or Restart.
            host.update(result.js, result.css);
        });
        return updateQueue;
    }
</script>

<section
    aria-label="Preview"
    class="flex flex-col shrink-0 overflow-hidden border-l border-surface-200-800 bg-surface-50-950 {width === undefined ? "flex-1" : ""}"
    style={width === undefined ? undefined : `width: ${width}px`}
>
    <header class="relative flex items-center gap-1 px-2 py-1 border-b border-surface-200-800">
        <h2 class="text-[11px] font-semibold text-surface-600-400 uppercase tracking-wide flex-1 pl-1">Preview</h2>
        {#if sections}
            <button type="button" class="btn-icon btn-icon-sm" title="Start at a section" aria-label="Start at a section" aria-haspopup="dialog" aria-expanded={startMenuOpen} onclick={toggleStartMenu}><Flag size={14} /></button>
            {#if startMenuOpen}
                <!-- Catches a click anywhere else, including over the story's frame -->
                <div class="fixed inset-0 z-20" role="presentation" onclick={() => { startMenuOpen = false; }}></div>
                <!-- The keydown handles Escape and Enter as they bubble up from the search box and the
                     buttons inside, which is all keyboard users need: the dialog itself isn't a control
                     (#639) -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <div
                    role="dialog"
                    aria-label="Start at a section"
                    tabindex="-1"
                    class="absolute right-2 top-full mt-1 z-30 w-64 max-w-[calc(100%-1rem)] flex flex-col max-h-[min(24rem,70vh)] p-2 rounded-md border border-surface-200-800 bg-surface-50-950 shadow-lg text-sm"
                    onkeydown={startMenuKeydown}
                >
                    <input
                        bind:this={startFindInput}
                        bind:value={startFind}
                        type="search"
                        class="input text-sm px-2 py-1"
                        placeholder="Find a section"
                        aria-label="Find a section"
                    />
                    <div class="mt-1 overflow-y-auto min-h-0">
                        {#snippet group(heading: string, list: StartSection[])}
                            {#if list.length}
                                {#if startSectionList.some(s => s.test)}
                                    <h3 class="px-2 pt-2 pb-0.5 text-[11px] font-semibold text-surface-600-400">{heading}</h3>
                                {/if}
                                <ul>
                                    {#each list as s (s.name)}
                                        <li>
                                            <button
                                                type="button"
                                                class="w-full text-left px-2 py-1 rounded hover:bg-surface-200-800 focus-visible:bg-surface-200-800 break-words {s.name === startAt?.section ? "font-semibold text-primary-600-400" : ""}"
                                                aria-current={s.name === startAt?.section ? "true" : undefined}
                                                onclick={() => startFrom(s.name)}
                                            >{s.name}</button>
                                        </li>
                                    {/each}
                                </ul>
                            {/if}
                        {/snippet}
                        {@render group("Test sections", startTests)}
                        {@render group("All sections", startOthers)}
                        {#if !startFound.length}
                            <p class="px-2 py-1 text-surface-600-400">No sections found.</p>
                        {/if}
                    </div>
                </div>
            {/if}
        {/if}
        <button type="button" class="btn-icon btn-icon-sm" title="Back" aria-label="Back" disabled={!canGoBack} onclick={() => host?.back()}><ArrowLeft size={14} /></button>
        <button type="button" class="btn-icon btn-icon-sm" title="Restart" aria-label="Restart" onclick={() => run(startAt)}><RotateCcw size={14} /></button>
        {#if usesSound}
            <button type="button" class="btn-icon btn-icon-sm" title={muted ? "Unmute" : "Mute"} aria-label={muted ? "Unmute" : "Mute"} onclick={toggleMuted}>{#if muted}<VolumeX size={14} />{:else}<Volume2 size={14} />{/if}</button>
        {/if}
        <!-- aria-disabled rather than disabled, so the tooltip still says why -->
        <button
            type="button"
            class="btn-icon btn-icon-sm"
            class:opacity-50={themeFixed}
            class:cursor-default={themeFixed}
            title={themeTitle}
            aria-label={themeTitle}
            aria-disabled={themeFixed}
            onclick={toggleTheme}
        >{#if previewDark}<Sun size={14} />{:else}<Moon size={14} />{/if}</button>
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
    <!-- The story's own page, which paints its own background in light or dark mode -->
    <iframe bind:this={iframe} title="Story preview" class="flex-1 w-full"></iframe>
    {#if Object.keys(attributes).length > 0}
        <div class="border-t border-surface-200-800 text-xs">
            <button
                type="button"
                class="w-full flex items-center gap-1 px-2 py-1 text-left font-semibold text-surface-600-400"
                aria-expanded={attributesOpen}
                onclick={() => { attributesOpen = !attributesOpen; }}
            >
                <ChevronRight size={12} class="transition-transform {attributesOpen ? "rotate-90" : ""}" />
                Attributes ({Object.keys(attributes).length})
            </button>
            {#if attributesOpen}
                <dl class="max-h-40 overflow-y-auto grid grid-cols-[auto_1fr] gap-x-3 px-3 pb-2 font-mono">
                    {#each Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b)) as [name, value] (name)}
                        <dt class="text-surface-600-400">{name}</dt>
                        <dd class="truncate" title={JSON.stringify(value)}>{JSON.stringify(value)}</dd>
                    {/each}
                </dl>
            {/if}
        </div>
    {/if}
</section>

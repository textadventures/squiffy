<script lang="ts">
    // The story's fonts: which one its text is in, and adding fonts from Fontsource (Google Fonts
    // and other open source fonts). An added font is copied into the story's fonts folder, so
    // only adding one needs the internet: the fonts in the story work offline, in the preview and
    // when publishing, and the published story doesn't ask Google for anything. See lib/fonts.ts.
    import { onMount } from "svelte";
    import type { OpenProject } from "#lib/project.svelte.js";
    import {
        addFont, DEFAULT_SUBSETS, fallbackFor, fetchCatalogue, fetchFontDetails, previewUrl, RECOMMENDED_FONTS, removeFont,
        setStoryFont, storyFonts, subsetLabel, type FontDetails, type FontSummary, type StoryFont,
    } from "#lib/fonts.js";
    import { confirmDialog } from "#lib/confirm.js";
    import { trapFocus } from "#lib/actions/trapFocus.js";
    import { DOCS_URL } from "#lib/links.js";

    interface Props {
        project: OpenProject;
        // Called with a font's new stylesheet, which a story without a squiffy.json has to @import
        onadded?: (css: string) => void;
        // Called with a font's stylesheet before it's removed
        onremoving?: (css: string) => void;
        oncancel: () => void;
    }
    const { project, onadded, onremoving, oncancel }: Props = $props();

    const SAMPLE = "The door creaks open. Beyond it, a narrow stair winds down into the dark. Will you take the lantern, or trust your luck?";
    const DEFAULT_STACK = `Charter, "Bitstream Charter", Georgia, serif`;

    let fonts = $state<StoryFont[]>([]);
    let busy = $state(false);
    let error = $state("");
    let dialogEl = $state<HTMLDivElement>();
    $effect(() => { dialogEl?.focus(); });

    async function refresh() {
        fonts = await storyFonts(project);
    }
    onMount(() => { void project.refreshFiles().then(refresh); });

    const storyFont = $derived(fonts.find(f => f.storyFont) ?? null);

    // The fonts in the story are already in the editor's own copy of the story, so show them in
    // their own font from the story's files, which works offline
    const loadedFamilies = new Map<string, Promise<boolean>>();
    async function loadStoryFontFace(font: StoryFont) {
        const key = `story:${font.css}`;
        if (loadedFamilies.has(key)) return;
        const file = project.files.map(f => f.path).find(path => path.startsWith(`${font.folder}/`) && /\b400-normal\.woff2?$/.test(path));
        if (!file) return;
        loadedFamilies.set(key, (async () => {
            try {
                const face = new FontFace(`squiffy-story-${font.folder}`, await project.fs.read(file) as BufferSource);
                document.fonts.add(await face.load());
                return true;
            } catch {
                return false;
            }
        })());
    }
    $effect(() => { for (const font of fonts) void loadStoryFontFace(font); });

    // Fonts from Fontsource, shown in their own font if it can be downloaded
    let previewed = $state<Record<string, boolean>>({});
    function loadPreview(id: string) {
        if (loadedFamilies.has(id)) return;
        loadedFamilies.set(id, new FontFace(`squiffy-preview-${id}`, `url(${previewUrl(id)})`).load().then(face => {
            document.fonts.add(face);
            previewed = { ...previewed, [id]: true };
            return true;
        }, () => false));
    }
    const previewFamily = (id: string, category: string) =>
        previewed[id] ? `"squiffy-preview-${id}", ${fallbackFor(category)}` : fallbackFor(category);

    // Adding a font
    let online = $state(typeof navigator === "undefined" || navigator.onLine);
    onMount(() => {
        const update = () => { online = navigator.onLine; };
        window.addEventListener("online", update);
        window.addEventListener("offline", update);
        return () => {
            window.removeEventListener("online", update);
            window.removeEventListener("offline", update);
        };
    });

    let search = $state("");
    let catalogue = $state<FontSummary[] | null>(null);
    let catalogueError = $state(false);
    $effect(() => {
        if (!online || !search.trim() || catalogue) return;
        catalogueError = false;
        fetchCatalogue().then(list => { catalogue = list; }, () => { catalogueError = true; });
    });
    const results = $derived.by((): { id: string; family: string; category: string }[] => {
        const query = search.trim().toLowerCase();
        if (!query) return RECOMMENDED_FONTS;
        if (!catalogue) return [];
        return catalogue.filter(f => f.family.toLowerCase().includes(query))
            .sort((a, b) => Number(!a.family.toLowerCase().startsWith(query)) - Number(!b.family.toLowerCase().startsWith(query)))
            .slice(0, 40);
    });
    $effect(() => { if (online) for (const font of results) loadPreview(font.id); });

    let chosen = $state<FontDetails | null>(null);
    let chosenError = $state("");
    let subsets = $state<string[]>([]);
    let makeStoryFont = $state(true);
    let progress = $state("");

    async function choose(id: string) {
        chosenError = "";
        try {
            const details = await fetchFontDetails(id);
            chosen = details;
            const defaults = details.subsets.filter(s => DEFAULT_SUBSETS.includes(s));
            subsets = defaults.length ? defaults : details.subsets.slice(0, 1);
            loadPreview(id);
        } catch {
            chosenError = "Couldn't get that font. Check you're online, then try again.";
        }
    }

    function toggleSubset(subset: string, on: boolean) {
        subsets = on ? [...subsets, subset] : subsets.filter(s => s !== subset);
    }

    async function add() {
        if (!chosen || !subsets.length) return;
        const font = chosen;
        if (fonts.some(f => f.folder === `fonts/${font.id}` || f.folder.endsWith(`/fonts/${font.id}`))
            && !(await confirmDialog(`${font.family} is already in the story. Download it again?`, { confirmLabel: "Download" }))) return;
        busy = true;
        error = "";
        progress = "Downloading…";
        try {
            const css = await addFont(project, font, subsets, {
                storyFont: makeStoryFont,
                onprogress: (done, total) => { progress = `Downloading ${done} of ${total} files…`; },
            });
            onadded?.(css);
            chosen = null;
            search = "";
            await refresh();
        } catch (err) {
            error = err instanceof Error ? err.message : String(err);
        } finally {
            busy = false;
            progress = "";
        }
    }

    async function use(font: StoryFont | null) {
        busy = true;
        error = "";
        try {
            await setStoryFont(project, font);
            await refresh();
        } catch (err) {
            error = err instanceof Error ? err.message : String(err);
        } finally {
            busy = false;
        }
    }

    async function remove(font: StoryFont) {
        const again = online ? "" : " You'll need to be online to add it again.";
        if (!(await confirmDialog(`Remove ${font.family} from the story? This deletes ${font.folder} and everything in it.${again}`, { confirmLabel: "Remove", danger: true }))) return;
        busy = true;
        error = "";
        try {
            onremoving?.(font.css);
            await removeFont(project, font);
            await refresh();
        } catch (err) {
            error = err instanceof Error ? err.message : String(err);
        } finally {
            busy = false;
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key !== "Escape") return;
        if (chosen) chosen = null;
        else oncancel();
    }
</script>

<div
    bind:this={dialogEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby="fonts-title"
    tabindex="-1"
    class="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
    onclick={e => { if (e.target === e.currentTarget) oncancel(); }}
    onkeydown={handleKeydown}
    use:trapFocus
>
    <!-- A fixed height, so the dialog doesn't change size and jump about as a search changes the list -->
    <div class="card bg-surface-50-950 rounded-xl shadow-xl w-full max-w-[36rem] h-[85dvh] p-6 flex flex-col gap-4">
        <div class="flex items-center justify-between">
            <h2 id="fonts-title" class="text-base font-semibold">Fonts</h2>
            <button class="btn btn-xs preset-tonal" onclick={oncancel}>Close</button>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
            <section class="flex flex-col gap-1" aria-labelledby="story-font-heading">
                <h3 id="story-font-heading" class="text-xs font-semibold uppercase tracking-wide text-surface-600-400">The story's text</h3>
                <label class="font-row">
                    <input type="radio" name="story-font" checked={!storyFont} disabled={busy} onchange={() => use(null)} />
                    <span class="flex-1 min-w-0">
                        <span class="block text-lg truncate" style:font-family={DEFAULT_STACK}>Squiffy's default</span>
                        <span class="block text-xs text-surface-600-400">Charter, or Georgia where there's no Charter</span>
                    </span>
                </label>
                {#each fonts as font (font.css)}
                    <div class="font-row">
                        <input type="radio" name="story-font" id={`font-${font.css}`} checked={font.storyFont} disabled={busy} onchange={() => use(font)} />
                        <label for={`font-${font.css}`} class="flex-1 min-w-0 cursor-pointer">
                            <span class="block text-lg truncate" style:font-family={`"squiffy-story-${font.folder}", ${DEFAULT_STACK}`}>{font.family}</span>
                            <span class="block text-xs text-surface-600-400 truncate">{font.folder}</span>
                        </label>
                        <button type="button" class="btn btn-xs preset-outlined-error-500 text-xs px-2 py-0.5" disabled={busy} onclick={() => remove(font)}>Remove</button>
                    </div>
                {/each}
                {#if storyFont === null && fonts.length}
                    <p class="text-xs text-surface-600-400">The fonts above are in the story for your own CSS to use, with <code>font-family</code>.</p>
                {/if}
            </section>

            <section class="flex flex-col gap-2" aria-labelledby="add-font-heading">
                <h3 id="add-font-heading" class="text-xs font-semibold uppercase tracking-wide text-surface-600-400">Add a font</h3>
                {#if !online}
                    <p class="text-sm">You're offline. Adding a font downloads it, so you'll need to be online. The fonts already in the story work offline.</p>
                {:else if chosen}
                    {@const font = chosen}
                    <div class="flex flex-col gap-3">
                        <div class="flex items-baseline justify-between gap-2">
                            <span class="text-lg font-semibold">{font.family}</span>
                            <button type="button" class="btn btn-xs preset-tonal" onclick={() => { chosen = null; }} disabled={busy}>Back</button>
                        </div>
                        <p class="text-lg leading-relaxed rounded border border-surface-200-800 p-3" style:font-family={previewFamily(font.id, font.category)}>
                            {SAMPLE} <b>Bold</b>, <i>italic</i>.
                        </p>
                        {#if font.subsets.length > 1}
                            <fieldset class="flex flex-col gap-1">
                                <legend class="text-xs text-surface-600-400 mb-1">Letters for</legend>
                                <div class="flex flex-wrap gap-x-4 gap-y-1">
                                    {#each font.subsets as subset (subset)}
                                        <label class="flex items-center gap-1.5 text-sm">
                                            <input type="checkbox" checked={subsets.includes(subset)} disabled={busy} onchange={e => toggleSubset(subset, e.currentTarget.checked)} />
                                            {subsetLabel(subset)}
                                        </label>
                                    {/each}
                                </div>
                            </fieldset>
                        {/if}
                        <label class="flex items-center gap-1.5 text-sm">
                            <input type="checkbox" bind:checked={makeStoryFont} disabled={busy} />
                            Use it for the story's text
                        </label>
                        <div class="flex items-center gap-2">
                            <button type="button" class="btn btn-xs preset-filled-primary-500" onclick={add} disabled={busy || !subsets.length}>Add to story</button>
                            {#if progress}<span class="text-xs text-surface-600-400">{progress}</span>{/if}
                        </div>
                    </div>
                {:else}
                    <input
                        class="input text-sm"
                        type="search"
                        placeholder="Search fonts"
                        aria-label="Search fonts"
                        bind:value={search}
                    />
                    {#if chosenError}<p class="text-xs text-error-600-400">{chosenError}</p>{/if}
                    {#if !search.trim()}
                        <p class="text-xs text-surface-600-400">Some good fonts for stories. Search for over 2,000 more.</p>
                    {:else if catalogueError}
                        <p class="text-xs text-error-600-400">Couldn't get the list of fonts. Check you're online, then try again.</p>
                    {:else if !catalogue}
                        <p class="text-xs text-surface-600-400">Getting the list of fonts…</p>
                    {:else if !results.length}
                        <p class="text-xs text-surface-600-400">No fonts called that.</p>
                    {/if}
                    <div class="flex flex-col">
                        {#each results as font (font.id)}
                            <button type="button" class="font-row text-left" onclick={() => choose(font.id)}>
                                <span class="flex-1 min-w-0 text-lg truncate" style:font-family={previewFamily(font.id, font.category)}>{font.family}</span>
                                <span class="text-xs text-surface-600-400 shrink-0">{font.category}</span>
                            </button>
                        {/each}
                    </div>
                {/if}
            </section>
        </div>

        {#if error}<p class="text-xs text-error-600-400">{error}</p>{/if}
        <p class="text-xs text-surface-600-400">
            Fonts come from <a class="anchor" href="https://fontsource.org" target="_blank" rel="noopener">Fontsource</a>,
            which has Google Fonts and other open source fonts. An added font is copied into your story's fonts folder,
            with its licence, so your story works offline and doesn't load anything from Google.
            <a class="anchor" href={`${DOCS_URL}/styling/#fonts`} target="_blank" rel="noopener">More about fonts</a>
        </p>
    </div>
</div>

<style>
    .font-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.25rem 0.375rem;
        border-radius: 0.25rem;
    }
    .font-row:hover {
        background-color: color-mix(in srgb, var(--color-surface-500) 12%, transparent);
    }
</style>

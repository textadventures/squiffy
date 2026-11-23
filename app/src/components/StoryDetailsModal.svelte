<script lang="ts">
    // Story details: squiffy.json's description, author, cover and language, which the published
    // page has, for search results, link previews and sites that list stories, as Quest Viva's
    // HTML exports do. The title is the main file's @title, so it's shown but not set here.
    import { onMount, untrack } from "svelte";
    import type { FileUrl } from "@textadventures/project-fs";
    import { languageTag, PROJECT_FILENAME } from "squiffy-compiler";
    import { LANGUAGES, languageOptions, suggestedLanguage } from "#lib/languages.js";
    import { storyPath, type OpenProject } from "#lib/project.svelte.js";
    import { isImage } from "#lib/file-types.js";
    import { isBuildPath } from "#lib/file-tree.js";
    import { DOCS_URL } from "#lib/links.js";
    import { trapFocus } from "#lib/actions/trapFocus.js";

    interface Props {
        project: OpenProject;
        // Adds a squiffy.json to a story that has none, which is where the details are kept.
        // Resolves to whether it did.
        onaddprojectfile: () => Promise<boolean>;
        onclose: () => void;
    }
    const { project, onaddprojectfile, onclose }: Props = $props();

    // Files added from outside the app (Finder, etc.) only show up after a fresh listing
    onMount(() => { void project.refreshFiles(); });

    // What's in squiffy.json when the dialog opens
    const initial = untrack(() => project.projectFile);
    let description = $state(initial?.description ?? "");
    let author = $state(initial?.author ?? "");
    let cover = $state(initial?.cover ?? "");

    // The language: one of those offered, or another typed in. A story with none is offered the
    // browser's, which the author is most likely writing in.
    const OTHER = "other";
    const languages = languageOptions();
    const initialLanguage = initial?.language ?? suggestedLanguage(navigator.languages);
    const offered = (LANGUAGES as readonly string[]).includes(initialLanguage ?? "");
    let languageChoice = $state(!initialLanguage ? "" : offered ? initialLanguage : OTHER);
    let otherLanguage = $state(!initialLanguage || offered ? "" : initialLanguage);
    let language = $derived(languageChoice === OTHER ? otherLanguage.trim() : languageChoice);
    let languageInvalid = $derived(languageChoice === OTHER && language !== "" && languageTag(language) === null);

    // A squiffy.json that's there but can't be read, which the details can't be saved in
    let unreadable = $derived(project.projectText !== null && !project.projectFile);

    // The images a cover can be, by their paths as the story refers to them: the ones beside the
    // main file or in a folder below it, which are published with the story
    let images = $derived(project.files
        .filter(f => isImage(f.path) && !isBuildPath(f.path))
        .map(f => ({ path: f.path, story: storyPath(project, f.path) }))
        .filter(image => !image.story.startsWith("../")));
    // A cover in squiffy.json that isn't one of them, such as one that's been deleted
    let missingCover = $derived(cover !== "" && !images.some(image => image.story === cover));

    // The chosen cover, to show
    let coverUrl = $state<string | null>(null);
    let coverFile: FileUrl | null = null;
    $effect(() => {
        const path = images.find(image => image.story === cover)?.path;
        coverFile?.release();
        coverFile = null;
        coverUrl = null;
        if (!path || !project.fs.url) return;
        let current = true;
        void project.fs.url(path).then(u => {
            if (current) {
                coverFile = u;
                coverUrl = u.url;
            } else {
                u.release();
            }
        });
        return () => { current = false; };
    });
    onMount(() => () => coverFile?.release());

    let saving = $state(false);
    let error = $state("");
    let dialogEl = $state<HTMLDivElement>();
    $effect(() => { dialogEl?.querySelector<HTMLElement>("textarea")?.focus(); });

    async function save() {
        saving = true;
        error = "";
        try {
            if (!project.projectFile && !(await onaddprojectfile())) return;
            if (languageInvalid) return;
            const tag = language ? languageTag(language) ?? "" : "";
            if (!(await project.setStoryDetails({ description, author, cover, language: tag }))) {
                error = `${PROJECT_FILENAME} couldn't be read. Fix it, then try again.`;
                return;
            }
            onclose();
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            saving = false;
        }
    }
</script>

<div
    bind:this={dialogEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby="story-details-title"
    tabindex="-1"
    class="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
    onclick={e => { if (e.target === e.currentTarget) onclose(); }}
    onkeydown={e => { if (e.key === "Escape") onclose(); }}
    use:trapFocus
>
    <form
        class="card bg-surface-50-950 rounded-xl shadow-xl w-full max-w-[32rem] max-h-[85dvh] p-6 flex flex-col gap-4"
        onsubmit={e => { e.preventDefault(); void save(); }}
    >
        <h2 id="story-details-title" class="text-base font-semibold">Story details</h2>

        <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
            <p class="text-sm text-surface-600-400">
                What your story is, for search results, link previews and sites that list stories,
                such as textadventures.co.uk. The language also tells screen readers and browsers how
                to read it. The title is the main file's <code>@title</code>.
            </p>

            <label class="flex flex-col gap-1">
                <span class="text-sm font-medium">Description</span>
                <textarea class="textarea text-sm" rows="3" bind:value={description} disabled={saving || unreadable}
                    placeholder="What the story is about, in a sentence or two"></textarea>
            </label>

            <label class="flex flex-col gap-1">
                <span class="text-sm font-medium">Author</span>
                <input class="input text-sm" type="text" bind:value={author} disabled={saving || unreadable} />
            </label>

            <div class="flex flex-col gap-1">
                <label class="flex flex-col gap-1">
                    <span class="text-sm font-medium">Cover image</span>
                    <select class="select text-sm bg-surface-50-950 px-2 py-1" bind:value={cover} disabled={saving || unreadable}>
                        <option value="">None</option>
                        {#if missingCover}
                            <option value={cover}>{cover} (not found)</option>
                        {/if}
                        {#each images as image (image.path)}
                            <option value={image.story}>{image.story}</option>
                        {/each}
                    </select>
                </label>
                {#if !images.length}
                    <p class="text-xs text-surface-600-400">Add an image to the story with Images and other files, then choose it here.</p>
                {/if}
                {#if coverUrl}
                    <img src={coverUrl} alt="The cover" class="mt-1 max-h-40 self-start rounded border border-surface-200-800" />
                {/if}
            </div>

            <div class="flex flex-col gap-1">
                <label class="flex flex-col gap-1">
                    <span class="text-sm font-medium">Language</span>
                    <select class="select text-sm bg-surface-50-950 px-2 py-1" bind:value={languageChoice} disabled={saving || unreadable}>
                        <option value="">Not set</option>
                        {#each languages as option (option.tag)}
                            <option value={option.tag}>{option.name}</option>
                        {/each}
                        <option value={OTHER}>Another language…</option>
                    </select>
                </label>
                {#if languageChoice === OTHER}
                    <label class="flex flex-col gap-1">
                        <span class="text-xs text-surface-600-400">Its language tag, such as <code>cy</code> for Welsh or <code>en-GB</code> for British English</span>
                        <input class="input text-sm" type="text" bind:value={otherLanguage} disabled={saving || unreadable}
                            aria-invalid={languageInvalid} spellcheck="false" autocapitalize="off" />
                    </label>
                    {#if languageInvalid}<p class="text-xs text-error-500">That isn't a language tag.</p>{/if}
                {/if}
            </div>

            {#if unreadable}
                <p class="text-xs text-error-500">{PROJECT_FILENAME} couldn't be read, so these can't be changed. Fix it, then try again.</p>
            {:else if !project.projectFile}
                <p class="text-xs text-surface-600-400">
                    These are kept in a {PROJECT_FILENAME} project file, which saving adds to the story.
                </p>
            {/if}
        </div>

        {#if error}<p class="text-xs text-error-500">{error}</p>{/if}
        <div class="flex items-center gap-2">
            <a class="anchor text-xs flex-1" href={`${DOCS_URL}/publishing/#story-details`} target="_blank" rel="noopener">More about story details</a>
            <button type="button" class="btn btn-sm preset-tonal" onclick={onclose}>Cancel</button>
            <button type="submit" class="btn btn-sm preset-filled-primary-500" disabled={saving || unreadable || languageInvalid}>Save</button>
        </div>
    </form>
</div>

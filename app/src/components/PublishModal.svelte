<script lang="ts">
    // Publish: every way of getting a story out to players, with what each is for. Three of them
    // save files for the author to put somewhere. One makes a link with the whole story in it, for
    // a small story (#lib/share-link.ts). The other sends the story to textadventures.co.uk:
    // the editor has no login there, so it uploads the published story and then sends the author to
    // a page on textadventures.co.uk, where they're signed in, to finish (the game's details for a
    // new story, or one button for an update), and this dialog says when that's done. See
    // #lib/publish-online.ts.
    import { onMount, untrack } from "svelte";
    import ExternalLink from "@lucide/svelte/icons/external-link";
    import CircleCheck from "@lucide/svelte/icons/circle-check";
    import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
    import Copy from "@lucide/svelte/icons/copy";
    import { MAX_ASSET_BYTES, SHORT_LINK_LENGTH, type StoryLink } from "#lib/share-link.js";
    import type { ExportKind } from "#lib/language/protocol.js";
    import type { OpenProject } from "#lib/project.svelte.js";
    import type { ProblemCounts } from "#lib/problems.js";
    import { checkStatus, publishClient, uploadStory, UploadError, type Upload } from "#lib/publish-online.js";
    import { loadPublishTarget, savePublishTarget, type PublishTarget } from "#lib/publish-target.js";
    import { DOCS_URL } from "#lib/links.js";
    import { trapFocus } from "#lib/actions/trapFocus.js";

    interface Props {
        project: OpenProject;
        problemCounts: ProblemCounts;
        // Saves the published story as a file. Resolves to what went wrong, if anything did.
        onexport: (kind: ExportKind) => Promise<string | null>;
        // Builds the published story to upload, or says why it can't be
        prepare: () => Promise<{ zip: Uint8Array; filename: string } | { error: string }>;
        // Makes a link with the story in it, or says why it can't be
        preparelink: () => Promise<StoryLink | { error: string }>;
        // Opens Story details, in place of this dialog
        ondetails: () => void;
        // Shows the Problems panel, in place of this dialog
        onproblems: () => void;
        onclose: () => void;
    }
    const { project, problemCounts, onexport, prepare, preparelink, ondetails, onproblems, onclose }: Props = $props();

    // How often to ask textadventures.co.uk whether the author has finished there
    const POLL_INTERVAL = 3000;

    const options: { value: PublishTarget; title: string; detail: string }[] = [
        { value: "online", title: "textadventures.co.uk", detail: "Put your story online for free, where players can find it. Publishing again updates it." },
        { value: "link", title: "A link", detail: "The whole story in a web address, with nothing to upload. For a small story: its text, and a few small images." },
        { value: "zip", title: "Zip for a website", detail: "HTML, JavaScript and your story's files, to upload to itch.io or your own site." },
        { value: "html", title: "One HTML file", detail: "Everything in a single page, for sharing, or for sites that take one file." },
        { value: "js", title: "JavaScript only", detail: "Just story.js, for embedding the story in a page of your own." },
    ];

    const storyId = untrack(() => project.projectFile?.id);
    let target = $state<PublishTarget>(loadPublishTarget(storyId));

    type Stage =
        | { name: "choose"; error?: string }
        // Saving a file
        | { name: "saving" }
        // A link with the story in it, to copy
        | { name: "link"; link: StoryLink; copied: boolean }
        | { name: "preparing" }
        | { name: "uploading"; progress: number }
        // Uploaded: the author goes to textadventures.co.uk to finish
        | { name: "uploaded"; upload: Upload; opened: boolean }
        | { name: "published"; gameUrl?: string }
        | { name: "error"; message: string };

    let stage = $state<Stage>({ name: "choose" });
    let busy = $derived(stage.name === "saving" || stage.name === "preparing" || stage.name === "uploading");
    let dialogEl = $state<HTMLDivElement>();
    const abort = new AbortController();

    // What the published page will say the story is
    let details = $derived(project.projectFile);
    let hasDetails = $derived(!!(details?.description || details?.author || details?.cover));
    let problems = $derived(problemCounts.error + problemCounts.warning);
    let problemsText = $derived.by(() => {
        const { error, warning } = problemCounts;
        const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
        return [error && count(error, "error"), warning && count(warning, "warning")].filter(Boolean).join(" and ");
    });

    async function publish() {
        savePublishTarget(storyId, target);
        if (target === "online") {
            await upload();
            return;
        }
        stage = { name: "saving" };
        if (target === "link") {
            const link = await preparelink();
            if (abort.signal.aborted) return;
            stage = "error" in link ? { name: "choose", error: link.error } : { name: "link", link, copied: false };
            return;
        }
        const error = await onexport(target);
        if (abort.signal.aborted) return;
        if (error) stage = { name: "choose", error };
        else onclose();
    }

    async function upload() {
        stage = { name: "preparing" };
        const prepared = await prepare();
        if (abort.signal.aborted) return;
        if ("error" in prepared) {
            stage = { name: "error", message: prepared.error };
            return;
        }
        stage = { name: "uploading", progress: 0 };
        try {
            const uploaded = await uploadStory(prepared.zip, prepared.filename, publishClient(), {
                signal: abort.signal,
                onprogress: fraction => {
                    if (stage.name === "uploading") stage = { name: "uploading", progress: fraction };
                },
            });
            // A browser only lets a page open a tab in answer to a click, and for a few seconds
            // after it, so after a long upload the author clicks the link instead
            const opened = navigator.userActivation?.isActive ? !!window.open(uploaded.claimUrl, "_blank", "noopener") : false;
            stage = { name: "uploaded", upload: uploaded, opened };
        } catch (err) {
            if (abort.signal.aborted) return;
            stage = { name: "error", message: err instanceof UploadError ? err.message : "Couldn't publish the story. Try again later." };
        }
    }

    async function copyLink() {
        if (stage.name !== "link") return;
        const link = stage.link;
        try {
            await navigator.clipboard.writeText(link.url);
        } catch {
            // No clipboard access: the link is selected, to copy by hand
            dialogEl?.querySelector<HTMLInputElement>("#publish-link")?.select();
            return;
        }
        stage = { name: "link", link, copied: true };
    }

    // The files a link leaves out, in a sentence: the first few, and how many more
    function fileList(files: string[]) {
        const shown = files.slice(0, 3).join(", ");
        return files.length > 3 ? `${shown} and ${files.length - 3} more` : shown;
    }

    async function check() {
        if (stage.name !== "uploaded") return;
        const id = stage.upload.id;
        const status = await checkStatus(id);
        if (stage.name !== "uploaded" || stage.upload.id !== id) return;
        if (status?.status === "published") stage = { name: "published", gameUrl: status.gameUrl };
        else if (status?.status === "gone") stage = { name: "error", message: "The story wasn't published within an hour of being uploaded, so it needs publishing again." };
    }

    onMount(() => {
        const timer = setInterval(() => void check(), POLL_INTERVAL);
        // Coming back from the tab where they finished
        const onfocus = () => void check();
        window.addEventListener("focus", onfocus);
        return () => {
            abort.abort();
            clearInterval(timer);
            window.removeEventListener("focus", onfocus);
        };
    });

    $effect(() => {
        // Each stage's main control: the chosen option, then its button or link
        void stage.name;
        (dialogEl?.querySelector<HTMLElement>("input[type=radio]:checked") ?? dialogEl?.querySelector<HTMLElement>("[data-primary]"))?.focus();
    });
</script>

<div
    bind:this={dialogEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby="publish-title"
    tabindex="-1"
    class="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
    onclick={e => { if (e.target === e.currentTarget) onclose(); }}
    onkeydown={e => { if (e.key === "Escape") onclose(); }}
    use:trapFocus
>
    <form
        class="card bg-surface-50-950 rounded-xl shadow-xl w-full max-w-[30rem] max-h-[90dvh] overflow-y-auto p-6 flex flex-col gap-4"
        onsubmit={e => { e.preventDefault(); if (stage.name === "choose") void publish(); }}
    >
        <h2 id="publish-title" class="text-base font-semibold">
            {stage.name === "choose" || stage.name === "saving" ? "Publish" : stage.name === "link" ? "Share a link" : "Publish to textadventures.co.uk"}
        </h2>

        {#if stage.name === "choose" || stage.name === "saving"}
            <section class="publish-details rounded-lg bg-surface-100-900 p-3 text-sm flex flex-col gap-1" aria-label="Story details">
                {#if hasDetails}
                    <div class="flex items-baseline justify-between gap-2">
                        <p class="font-medium truncate">{project.displayName}</p>
                        <button type="button" class="anchor shrink-0 text-xs" disabled={busy} onclick={ondetails}>Edit details</button>
                    </div>
                    {#if details?.author}<p class="text-xs text-surface-600-400">by {details.author}</p>{/if}
                    <!-- A long description is cut short here -->
                    <p class="text-xs text-surface-600-400 line-clamp-2">{details?.description || "No description yet."}</p>
                    {#if details?.cover}<p class="text-xs text-surface-600-400">Cover: {details.cover}</p>{/if}
                {:else}
                    <!-- Nothing to show yet, so this asks for it, with the button right under the reason -->
                    <p class="font-medium truncate">{project.displayName}</p>
                    <p class="text-xs text-surface-600-400">
                        Your story has no description or cover yet. Players see them on its textadventures.co.uk page,
                        in search results and in link previews.
                    </p>
                    <button type="button" class="btn btn-sm preset-tonal self-start mt-1" disabled={busy} onclick={ondetails}>Add story details</button>
                {/if}
            </section>

            <fieldset class="flex flex-col gap-3" disabled={busy}>
                <legend class="text-sm text-surface-600-400 mb-3">Choose how to share your story.</legend>
                {#each options as option (option.value)}
                    <label class="flex items-start gap-2 text-sm cursor-pointer">
                        <!-- One line tall, so the radio centres on the caption's first line -->
                        <span class="flex h-[1lh] shrink-0 items-center">
                            <input type="radio" name="publish-target" value={option.value} bind:group={target} />
                        </span>
                        <span>
                            <span class="font-medium">{option.title}</span>
                            <span class="text-surface-600-400"> — {option.detail}</span>
                        </span>
                    </label>
                {/each}
            </fieldset>

            {#if problems}
                <p class="publish-problems flex items-start gap-2 text-sm text-warning-700-300">
                    <TriangleAlert class="size-4 shrink-0 mt-0.5" />
                    <span>
                        This story has {problemsText}.
                        <button type="button" class="anchor" disabled={busy} onclick={onproblems}>Show {problems === 1 ? "it" : "them"}</button>
                    </span>
                </p>
            {/if}

            {#if stage.name === "choose" && stage.error}<p class="text-sm text-error-500" role="alert">{stage.error}</p>{/if}
        {:else if stage.name === "link"}
            {@const length = stage.link.url.length}
            <div class="publish-link flex flex-col gap-3 text-sm">
                <p>This link is your story. Anyone who opens it can play it, and nothing has been uploaded.</p>
                <div class="flex gap-2">
                    <input
                        id="publish-link"
                        class="input text-xs flex-1 min-w-0 font-mono"
                        type="text"
                        readonly
                        value={stage.link.url}
                        aria-label="Link to the story"
                        onfocus={e => e.currentTarget.select()}
                    />
                    <button type="button" class="btn btn-sm preset-filled-primary-500 shrink-0" onclick={() => void copyLink()} data-primary>
                        {#if stage.copied}<CircleCheck class="size-4" /> Copied{:else}<Copy class="size-4" /> Copy{/if}
                    </button>
                </div>
                <span class="sr-only" aria-live="polite">{stage.copied ? "Link copied" : ""}</span>
                {#if length > SHORT_LINK_LENGTH}
                    <p class="flex items-start gap-2 text-warning-700-300">
                        <TriangleAlert class="size-4 shrink-0 mt-0.5" />
                        <span>
                            At {length.toLocaleString()} characters, it's too long for some chat apps, which cut a long
                            message short. It'll work in an email, or as a link on a web page.
                        </span>
                    </p>
                {:else}
                    <p class="text-xs text-surface-600-400">It's {length.toLocaleString()} characters long, which is short enough to paste anywhere.</p>
                {/if}
                {#if stage.link.assets.length}
                    <p class="text-xs text-surface-600-400">It has {fileList(stage.link.assets)} in it, as well as the story's text.</p>
                {/if}
                {#if stage.link.leftOut.length}
                    <p class="flex items-start gap-2 text-warning-700-300">
                        <TriangleAlert class="size-4 shrink-0 mt-0.5" />
                        <span>
                            Not in the link: {fileList(stage.link.leftOut)}. A link has room for the story's text and
                            for images of up to {MAX_ASSET_BYTES / 1024} KB each. A bigger image, or a sound, has to
                            be a web address to work.
                        </span>
                    </p>
                {/if}
                <p class="text-xs text-surface-600-400">
                    The link plays the story as it is now. If you change the story, make a new link. Players can
                    also open the story in the editor, to make a version of their own.
                </p>
                <a class="anchor self-start flex items-center gap-1" href={stage.link.url} target="_blank" rel="noopener">
                    <ExternalLink class="size-4" /> Play it
                </a>
            </div>
        {:else}
            <div class="flex flex-col gap-3 text-sm" aria-live="polite">
                {#if stage.name === "preparing"}
                    <p>Getting the story ready…</p>
                {:else if stage.name === "uploading"}
                    <p>Uploading the story…</p>
                    <progress class="progress w-full" value={stage.progress} max="1" aria-label="Upload progress"></progress>
                {:else if stage.name === "uploaded"}
                    {#if stage.opened}
                        <p>Your story is uploaded. To finish, log in and publish it in the tab that's opened on textadventures.co.uk.</p>
                    {:else}
                        <p>Your story is uploaded. To finish, continue on textadventures.co.uk, where you'll log in and publish it.</p>
                    {/if}
                    <a
                        class="btn preset-filled-primary-500 self-start"
                        href={stage.upload.claimUrl}
                        target="_blank"
                        rel="noopener"
                        data-primary
                    >
                        <ExternalLink class="size-4" />
                        Continue on textadventures.co.uk
                    </a>
                    <p class="text-xs text-surface-600-400">
                        This will say when it's published. The upload is kept for an hour.
                    </p>
                {:else if stage.name === "published"}
                    <p class="flex items-center gap-2"><CircleCheck class="size-5 text-success-500 shrink-0" /> Your story is published.</p>
                    {#if stage.gameUrl}
                        <a class="btn preset-filled-primary-500 self-start" href={stage.gameUrl} target="_blank" rel="noopener" data-primary>
                            <ExternalLink class="size-4" />
                            See it on textadventures.co.uk
                        </a>
                    {/if}
                {:else if stage.name === "error"}
                    <p class="text-error-500" role="alert">{stage.message}</p>
                {/if}
            </div>
        {/if}

        <div class="flex items-center gap-2">
            <a class="anchor text-xs flex-1" href={`${DOCS_URL}/publishing/`} target="_blank" rel="noopener">More about publishing</a>
            {#if stage.name === "error"}
                <button type="button" class="btn btn-sm preset-tonal" onclick={() => { stage = { name: "choose" }; }}>Back</button>
                <button type="button" class="btn btn-sm preset-tonal" onclick={() => void upload()} data-primary>Try again</button>
            {/if}
            <button type="button" class="btn btn-sm preset-tonal" onclick={onclose} data-primary={stage.name === "published" && !stage.gameUrl ? "" : undefined}>
                {stage.name === "published" || stage.name === "error" || stage.name === "link" ? "Close" : "Cancel"}
            </button>
            {#if stage.name === "choose" || stage.name === "saving"}
                <button type="submit" class="btn btn-sm preset-filled-primary-500" disabled={busy}>
                    {stage.name === "saving" ? "Publishing…" : "Publish"}
                </button>
            {/if}
        </div>
    </form>
</div>

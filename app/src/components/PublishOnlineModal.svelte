<script lang="ts">
    // Publishes the story to textadventures.co.uk. The editor has no login there, so it uploads the
    // published story and then sends the author to a page on textadventures.co.uk, where they're
    // signed in, to finish: the game's details for a new story, or one button for an update. This
    // dialog then says when it's done. See #lib/publish-online.ts.
    import { onMount } from "svelte";
    import ExternalLink from "@lucide/svelte/icons/external-link";
    import CircleCheck from "@lucide/svelte/icons/circle-check";
    import { checkStatus, publishClient, uploadStory, UploadError, type Upload } from "#lib/publish-online.js";
    import { DOCS_URL } from "#lib/links.js";
    import { trapFocus } from "#lib/actions/trapFocus.js";

    interface Props {
        // Builds the published story, or says why it can't be
        prepare: () => Promise<{ zip: Uint8Array; filename: string } | { error: string }>;
        onclose: () => void;
    }
    const { prepare, onclose }: Props = $props();

    // How often to ask textadventures.co.uk whether the author has finished there
    const POLL_INTERVAL = 3000;

    type Stage =
        | { name: "preparing" }
        | { name: "uploading"; progress: number }
        // Uploaded: the author goes to textadventures.co.uk to finish
        | { name: "uploaded"; upload: Upload; opened: boolean }
        | { name: "published"; gameUrl?: string }
        | { name: "error"; message: string };

    let stage = $state<Stage>({ name: "preparing" });
    let dialogEl = $state<HTMLDivElement>();
    const abort = new AbortController();

    async function publish() {
        stage = { name: "preparing" };
        const prepared = await prepare();
        if (abort.signal.aborted) return;
        if ("error" in prepared) {
            stage = { name: "error", message: prepared.error };
            return;
        }
        stage = { name: "uploading", progress: 0 };
        try {
            const upload = await uploadStory(prepared.zip, prepared.filename, publishClient(), {
                signal: abort.signal,
                onprogress: fraction => {
                    if (stage.name === "uploading") stage = { name: "uploading", progress: fraction };
                },
            });
            // A browser only lets a page open a tab in answer to a click, and for a few seconds
            // after it, so after a long upload the author clicks the link instead
            const opened = navigator.userActivation?.isActive ? !!window.open(upload.claimUrl, "_blank", "noopener") : false;
            stage = { name: "uploaded", upload, opened };
        } catch (err) {
            if (abort.signal.aborted) return;
            stage = { name: "error", message: err instanceof UploadError ? err.message : "Couldn't publish the story. Try again later." };
        }
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
        void publish();
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
        // Each stage's main button or link
        void stage.name;
        dialogEl?.querySelector<HTMLElement>("[data-primary]")?.focus();
    });
</script>

<div
    bind:this={dialogEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby="publish-online-title"
    tabindex="-1"
    class="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
    onclick={e => { if (e.target === e.currentTarget) onclose(); }}
    onkeydown={e => { if (e.key === "Escape") onclose(); }}
    use:trapFocus
>
    <div class="card bg-surface-50-950 rounded-xl shadow-xl w-full max-w-[28rem] p-6 flex flex-col gap-4">
        <h2 id="publish-online-title" class="text-base font-semibold">Publish to textadventures.co.uk</h2>

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
            {:else}
                <p class="text-error-500" role="alert">{stage.message}</p>
            {/if}
        </div>

        <div class="flex items-center gap-2">
            <a class="anchor text-xs flex-1" href={`${DOCS_URL}/publishing/#publishing-to-textadventurescouk`} target="_blank" rel="noopener">More about publishing</a>
            {#if stage.name === "error"}
                <button type="button" class="btn btn-sm preset-tonal" onclick={() => void publish()}>Try again</button>
            {/if}
            <button type="button" class="btn btn-sm preset-tonal" onclick={onclose} data-primary={stage.name === "error" || (stage.name === "published" && !stage.gameUrl) ? "" : undefined}>
                {stage.name === "published" || stage.name === "error" ? "Close" : "Cancel"}
            </button>
        </div>
    </div>
</div>

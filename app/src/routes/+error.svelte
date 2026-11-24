<script lang="ts">
    // Shown in place of a page when the editor hits an exception it didn't catch (with the real
    // message, from hooks.client.ts), or for an address that isn't one of the app's pages.
    // The open story outlives the editor page, so its unsaved changes are saved straight away.
    import { onMount } from "svelte";
    import { page } from "$app/state";
    import { base } from "#lib/base-path.js";
    import { ISSUES_URL } from "#lib/links.js";
    import { project } from "#lib/project.svelte.js";
    import TriangleAlert from "@lucide/svelte/icons/triangle-alert";

    const notFound = $derived(page.status === 404);
    const message = $derived(page.error?.message ?? "Unknown error");
    const detail = $derived(page.error?.detail);

    // null: nothing to save
    let saved = $state<"saving" | "saved" | string | null>(null);
    let copied = $state(false);

    onMount(() => {
        const current = project.current;
        if (!current) return;
        saved = "saving";
        current.save().then(
            () => saved = current.saveError ? `Couldn't save your changes: ${current.saveError}` : "saved",
            (err: unknown) => saved = `Couldn't save your changes: ${err instanceof Error ? err.message : String(err)}`,
        );
    });

    async function copyDetails() {
        const text = [`Squiffy ${__APP_VERSION__}`, navigator.userAgent, page.url.pathname, "", detail ?? message].join("\n");
        try {
            await navigator.clipboard.writeText(text);
            copied = true;
            setTimeout(() => copied = false, 2000);
        } catch {
            // The details are on the page to select by hand
        }
    }
</script>

<main class="max-w-2xl mx-auto px-4 py-10 flex flex-col gap-5">
    {#if notFound}
        <h1 class="text-xl font-semibold">Page not found</h1>
        <p class="text-sm">There's no page at this address.</p>
        <div>
            <a class="btn btn-sm preset-filled-primary-500" href="{base}/">Go to the home page</a>
        </div>
    {:else}
        <div class="flex items-center gap-3">
            <TriangleAlert size={26} class="shrink-0 text-error-600-400" />
            <h1 class="text-xl font-semibold">Something went wrong in the editor</h1>
        </div>

        {#if saved === "saving"}
            <p class="text-sm">Saving your changes…</p>
        {:else if saved === "saved"}
            <p class="text-sm">Your changes are saved. Reloading should take you back to where you were.</p>
        {:else if saved}
            <p role="alert" class="text-sm text-error-600-400">{saved}</p>
        {/if}

        <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-sm preset-filled-primary-500" disabled={saved === "saving"} onclick={() => location.reload()}>Reload</button>
            <a class="btn btn-sm preset-tonal" href="{base}/" data-sveltekit-reload>Go to the home page</a>
        </div>

        <section aria-labelledby="error-details-heading" class="card preset-outlined-error-500 p-4 flex flex-col gap-3">
            <h2 id="error-details-heading" class="font-semibold text-sm">{message}</h2>
            {#if detail}
                <pre class="text-xs overflow-x-auto whitespace-pre max-h-72">{detail}</pre>
            {/if}
            <p class="text-xs text-surface-600-400">
                This is a bug in Squiffy {__APP_VERSION__}. Please
                <a class="anchor" href={ISSUES_URL} target="_blank" rel="noopener noreferrer">report it</a>
                with these details, and what you were doing when it happened.
            </p>
            <div>
                <button type="button" class="btn btn-xs preset-tonal" onclick={copyDetails}>{copied ? "Copied" : "Copy details"}</button>
            </div>
        </section>
    {/if}
</main>

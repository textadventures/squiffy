<script lang="ts">
    // Only in a prerelease build: on app-beta.squiffystory.com (deploy-app.yml sets VITE_BETA_APP),
    // as Quest Viva's beta site has, and in the Squiffy Beta desktop app (desktop-publish.yml).
    // Drafts are kept per site, so the web one says so.
    import { isElectron } from "#lib/runtime.js";

    const desktop = isElectron();
</script>

<div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-warning-100-900 border-b border-warning-300-700 text-sm">
    {#if desktop}
        <span class="flex-1 basis-80">
            This is Squiffy Beta, the beta of the next version of Squiffy. It's a separate app from Squiffy, so you can have both.
        </span>
        <a href="https://github.com/textadventures/squiffy/releases/latest" class="anchor font-semibold">Get the current version</a>
    {:else}
        <span class="flex-1 basis-80">
            This is the beta of the next version of Squiffy. Drafts here are kept separately from the ones on
            app.squiffystory.com: use Download project and Open file to move a story between them.
        </span>
        <a href="https://app.squiffystory.com/" class="anchor font-semibold">Go to the current version</a>
    {/if}
</div>

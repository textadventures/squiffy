<script lang="ts">
    // From Quest Viva's HomeHeader: the logo and name, with links to the docs, GitHub and Settings.
    import { base } from "#lib/base-path.js";
    import { settings } from "#lib/settings.svelte.js";
    import { DOCS_URL, GITHUB_URL } from "#lib/links.js";
    import GithubIcon from "#components/GithubIcon.svelte";
    import SettingsIcon from "@lucide/svelte/icons/settings";
    import BookOpen from "@lucide/svelte/icons/book-open";
</script>

<header class="flex items-center gap-3 px-4 pt-4 pb-2 text-surface-900-100">
    <img src="{base}/squiffy.png" alt="" class="h-7" />
    <h1 class="text-xl font-semibold">Squiffy</h1>
    <div class="ml-auto flex items-center gap-1">
        <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" class="home-header-link" title="Documentation" aria-label="Documentation">
            <BookOpen size={18} />
        </a>
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" class="home-header-link" title="View on GitHub" aria-label="View on GitHub">
            <GithubIcon size={18} />
        </a>
        <button type="button" class="home-header-link" title="Settings" aria-label="Settings" onclick={() => { settings.open = true; }}>
            <SettingsIcon size={18} />
        </button>
    </div>
</header>

<style>
    .home-header-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: var(--radius-container);
        opacity: 0.7;
    }
    .home-header-link:hover {
        opacity: 1;
        background-color: color-mix(in srgb, currentColor 12%, transparent);
    }
</style>

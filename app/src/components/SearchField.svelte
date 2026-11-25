<script lang="ts">
    // A small search box, as in the outline and on the story map: a magnifying glass at the start,
    // and a button to clear it at the end, in place of the browser's own, which is bigger than the
    // icon, further from its edge, and only there while the box has the focus.
    import Search from "@lucide/svelte/icons/search";
    import X from "@lucide/svelte/icons/x";

    interface Props {
        value: string;
        placeholder: string;
        label: string;
        title?: string;
        // For the classes that size it: the input itself takes its width from them
        class?: string;
        // Less padding, for a toolbar
        compact?: boolean;
        onkeydown?: (e: KeyboardEvent) => void;
        input?: HTMLInputElement;
    }

    let { value = $bindable(), placeholder, label, title, class: className = "", compact = false, onkeydown, input = $bindable() }: Props = $props();
</script>

<div class="relative {className}">
    <Search size={13} class="absolute z-10 left-2 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none" />
    <input
        bind:this={input}
        bind:value
        type="search"
        class="search-field input text-xs {compact ? "py-0.5" : "py-1"} pl-7 {value ? "pr-7" : ""}"
        {placeholder}
        aria-label={label}
        {title}
        {onkeydown}
    />
    {#if value}
        <!-- Escape clears it from the keyboard, so the button needn't be a tab stop -->
        <button
            type="button"
            tabindex="-1"
            class="absolute z-10 right-1 top-1/2 -translate-y-1/2 btn-icon btn-icon-sm p-0.5 w-5 h-5 min-w-0 opacity-60 hover:opacity-100"
            title="Clear the search (Escape)"
            aria-label="Clear the search"
            onclick={() => { value = ""; input?.focus(); }}
        ><X size={13} /></button>
    {/if}
</div>

<style>
    .search-field::-webkit-search-cancel-button {
        appearance: none;
        display: none;
    }
</style>

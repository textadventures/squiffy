<script lang="ts">
    // Where a section or passage is used (Shift+F12), as a panel under the editor, like Quest
    // Viva's Check panel. Clicking one moves the editor there.
    import type { Location } from "squiffy-compiler/language-service";
    import X from "@lucide/svelte/icons/x";

    interface Props {
        name: string;
        locations: Location[];
        // The text of each file the locations are in, to show the line each one is on
        textOf: (file: string) => string | undefined;
        onselect: (location: Location) => void;
        onclose: () => void;
    }

    let { name, locations, textOf, onselect, onclose }: Props = $props();

    function lineText(location: Location) {
        return textOf(location.file)?.split("\n")[location.range.start.line]?.trim() ?? "";
    }
</script>

<section aria-label="References" class="flex flex-col max-h-[30vh] border-t border-surface-200-800 bg-surface-50-950">
    <header class="flex items-center gap-2 px-3 py-1.5 border-b border-surface-200-800">
        <h2 class="text-xs font-semibold flex-1 truncate">
            {locations.length === 0 ? "No links to" : locations.length === 1 ? "1 link to" : `${locations.length} links to`}
            {name ? `'${name}'` : "this"}
        </h2>
        <button type="button" class="btn-icon btn-icon-sm" aria-label="Close references" onclick={onclose}><X size={14} /></button>
    </header>
    <ul class="overflow-y-auto text-xs">
        {#each locations as location, i (i)}
            <li>
                <button
                    type="button"
                    class="reference w-full text-left flex gap-3 px-3 py-1"
                    onclick={() => onselect(location)}
                >
                    <span class="text-surface-600-400 shrink-0 tabular-nums">{location.file}:{location.range.start.line + 1}</span>
                    <span class="font-mono truncate">{lineText(location)}</span>
                </button>
            </li>
        {/each}
    </ul>
</section>

<style>
    .reference:hover {
        background-color: var(--color-surface-100-900);
    }
</style>

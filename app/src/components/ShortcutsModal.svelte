<script lang="ts">
    // Keyboard shortcuts: the editor's own, and the most useful of CodeMirror's (src/lib/shortcuts.ts),
    // for this platform.
    import { SHORTCUT_GROUPS, keyNames, shortcutKeys } from "#lib/shortcuts.js";
    import { shortcutsDialog } from "#lib/shortcuts-dialog.svelte.js";
    import { trapFocus } from "#lib/actions/trapFocus.js";
    import X from "@lucide/svelte/icons/x";

    function close() {
        shortcutsDialog.open = false;
    }

    // Focused when it opens, so Escape closes it (the menu that opened it puts focus back on its button)
    let dialogEl = $state<HTMLDivElement>();
    $effect(() => { dialogEl?.focus(); });
</script>

{#if shortcutsDialog.open}
    <div
        bind:this={dialogEl}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        tabindex="-1"
        class="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
        onclick={e => { if (e.target === e.currentTarget) close(); }}
        onkeydown={e => { if (e.key === "Escape") close(); }}
        use:trapFocus
    >
        <div class="card bg-surface-50-950 rounded-xl shadow-xl w-full max-w-3xl max-h-[calc(100dvh-2rem)] flex flex-col">
            <div class="flex items-center px-6 pt-5 pb-3">
                <h2 id="shortcuts-title" class="text-lg font-semibold flex-1">Keyboard shortcuts</h2>
                <button type="button" class="btn-icon btn-icon-sm" aria-label="Close" onclick={close}><X size={16} /></button>
            </div>
            <div class="overflow-y-auto px-6 pb-6 columns-1 md:columns-2 gap-8">
                {#each SHORTCUT_GROUPS as group (group.heading)}
                    <section class="break-inside-avoid mb-5">
                        <h3 class="text-[11px] font-semibold text-surface-600-400 uppercase tracking-wide mb-1.5">{group.heading}</h3>
                        <dl class="text-xs">
                            {#each group.shortcuts as shortcut (shortcut.description)}
                                <div class="flex items-baseline gap-3 py-1 border-b border-surface-100-900">
                                    <dt class="shrink-0 flex flex-wrap gap-x-1.5 gap-y-1">
                                        {#each shortcutKeys(shortcut) as key, i (key)}
                                            {#if i > 0}<span class="text-surface-600-400">or</span>{/if}
                                            <span class="inline-flex gap-0.5">
                                                {#each keyNames(key) as name, j (j)}<kbd class="kbd">{name}</kbd>{/each}
                                            </span>
                                        {/each}
                                    </dt>
                                    <dd class="flex-1 text-right">{shortcut.description}</dd>
                                </div>
                            {/each}
                        </dl>
                    </section>
                {/each}
            </div>
        </div>
    </div>
{/if}

<style>
    .kbd {
        font-family: inherit;
        font-size: 11px;
        line-height: 1;
        padding: 0.2rem 0.35rem;
        min-width: 1.4rem;
        text-align: center;
        border-radius: 0.25rem;
        border: 1px solid var(--color-surface-300-700);
        border-bottom-width: 2px;
        background-color: var(--color-surface-100-900);
    }
</style>

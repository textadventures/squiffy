<script lang="ts">
    // Settings: the theme (#176), as in Quest Viva's Settings dialog, and the editor's text size,
    // as in the 6.x editor's.
    import { theme, setTheme, type ThemePreference } from "#lib/theme-store.js";
    import { settings, setFontSize, FONT_SIZES, DEFAULT_FONT_SIZE } from "#lib/settings.svelte.js";
    import { trapFocus } from "#lib/actions/trapFocus.js";
    import X from "@lucide/svelte/icons/x";

    const options: { value: ThemePreference; label: string }[] = [
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
        { value: "system", label: "Match system" },
    ];

    function close() {
        settings.open = false;
    }
</script>

{#if settings.open}
    <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabindex="-1"
        class="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
        onclick={e => { if (e.target === e.currentTarget) close(); }}
        onkeydown={e => { if (e.key === "Escape") close(); }}
        use:trapFocus
    >
        <div class="card bg-surface-50-950 rounded-xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
            <div class="flex items-center">
                <h2 id="settings-title" class="text-lg font-semibold flex-1">Settings</h2>
                <button type="button" class="btn-icon btn-icon-sm" aria-label="Close" onclick={close}><X size={16} /></button>
            </div>
            <fieldset class="flex flex-col gap-2">
                <legend class="text-sm font-medium mb-2">Theme</legend>
                <div class="flex gap-2">
                    {#each options as option (option.value)}
                        <button
                            type="button"
                            class="btn btn-sm flex-1 {$theme === option.value ? "preset-filled-primary-500" : "preset-tonal"}"
                            aria-pressed={$theme === option.value}
                            onclick={() => setTheme(option.value)}
                        >{option.label}</button>
                    {/each}
                </div>
            </fieldset>
            <label class="flex flex-col gap-2">
                <span class="text-sm font-medium">Editor text size</span>
                <select class="select bg-surface-50-950 px-2 py-1 text-sm" value={settings.fontSize} onchange={e => setFontSize(Number(e.currentTarget.value))}>
                    {#each FONT_SIZES as size (size)}
                        <option value={size}>{size}px{size === DEFAULT_FONT_SIZE ? " (default)" : ""}</option>
                    {/each}
                </select>
            </label>
        </div>
    </div>
{/if}

<script lang="ts">
    import { tick } from "svelte";
    import { dialogState } from "#lib/confirm.js";
    import { trapFocus } from "#lib/actions/trapFocus.js";

    let dialogEl = $state<HTMLDivElement>();
    let inputEl = $state<HTMLInputElement>();
    // What's typed in promptDialog()'s text box
    let text = $state("");
    // Which of checklistDialog()'s boxes are ticked
    let checked = $state<boolean[]>([]);

    // Fills the text box when a dialog opens, then focuses it (or the dialog) once it's on screen.
    // Selecting before the value is rendered would leave the cursor at the end instead.
    $effect(() => {
        const state = $dialogState;
        if (!state) return;
        text = state.input ?? "";
        checked = state.checklist?.map(item => item.checked) ?? [];
        void tick().then(() => {
            if (state.input === undefined) {
                dialogEl?.focus();
            } else {
                inputEl?.focus();
                inputEl?.select();
            }
        });
    });

    function respond(result: unknown) {
        $dialogState?.resolve(result, text, checked);
        dialogState.set(null);
    }

    // The last choice is treated as the primary/default action (filled button, rightmost) —
    // matches how the 2-choice confirmDialog() wrapper orders [cancel, confirm].
    function handleKeydown(e: KeyboardEvent) {
        if (!$dialogState) return;
        if (e.key === "Escape") respond(null);
        if (e.key === "Enter") {
            e.preventDefault();
            respond($dialogState.choices.at(-1)?.value);
        }
    }

    function onBackdropClick(e: MouseEvent) {
        if (e.target === e.currentTarget) respond(null);
    }
</script>

{#if $dialogState}
    {@const state = $dialogState}
    <div
        bind:this={dialogEl}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        class="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
        onclick={onBackdropClick}
        onkeydown={handleKeydown}
        use:trapFocus
    >
        <div class="card bg-surface-50-950 rounded-xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
            <p class="text-sm whitespace-pre-line">{state.message}</p>
            {#if state.input !== undefined}
                <input bind:this={inputEl} bind:value={text} class="input text-sm" type="text" aria-label={state.message} />
            {/if}
            {#if state.checklist}
                <ul class="max-h-60 overflow-y-auto flex flex-col gap-1 text-sm">
                    {#each state.checklist as item, i (item.label)}
                        <li>
                            <label class="flex items-center gap-2" class:opacity-60={item.disabled}>
                                <input type="checkbox" class="checkbox" bind:checked={checked[i]} disabled={item.disabled} />
                                <span class="truncate">{item.label}</span>
                            </label>
                        </li>
                    {/each}
                </ul>
            {/if}

            <div class="flex flex-wrap justify-end gap-2">
                {#each state.choices as choice, i (choice.label)}
                    {@const isPrimary = i === state.choices.length - 1}
                    <button
                        class={`btn btn-xs ${isPrimary ? (choice.danger ? "preset-filled-error-500" : "preset-filled-primary-500") : "preset-tonal"}`}
                        onclick={() => respond(choice.value)}
                    >{choice.label}</button>
                {/each}
            </div>
        </div>
    </div>
{/if}

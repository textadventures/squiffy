// Promise-based dialogs, rendered by ConfirmDialog.svelte (mounted once in +layout.svelte).
import { writable } from "svelte/store";

export interface DialogChoice<T> {
    label: string;
    value: T;
    danger?: boolean;
}

interface DialogState {
    message: string;
    choices: DialogChoice<unknown>[];
    // For promptDialog(), `text` is what's in the text box; for checklistDialog(), `checked` is
    // which boxes are ticked
    resolve: (result: unknown, text?: string, checked?: boolean[]) => void;
    // A text box, for promptDialog(): its starting text
    input?: string;
    // A list of checkboxes, for checklistDialog()
    checklist?: ChecklistItem[];
}

export interface ChecklistItem {
    label: string;
    checked: boolean;
    // Shown ticked, but can't be changed
    disabled?: boolean;
}

export const dialogState = writable<DialogState | null>(null);

// Resolves with the chosen value, or null if dismissed with Escape or a click outside. The last
// choice is the primary one.
export function chooseDialog<T>(message: string, choices: DialogChoice<T>[]): Promise<T | null> {
    return new Promise(resolve => {
        dialogState.set({
            message,
            choices: choices as DialogChoice<unknown>[],
            resolve: resolve as (result: unknown) => void,
        });
    });
}

export interface ConfirmOptions {
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
}

export async function confirmDialog(message: string, options?: ConfirmOptions): Promise<boolean> {
    const result = await chooseDialog(message, [
        { label: options?.cancelLabel ?? "Cancel", value: false },
        { label: options?.confirmLabel ?? "OK", value: true, danger: options?.danger },
    ]);
    return result ?? false;
}

// Asks for some text, e.g. a new name. Resolves with the text, or null if cancelled.
export function promptDialog(message: string, initial = "", confirmLabel = "OK"): Promise<string | null> {
    return new Promise(resolve => {
        dialogState.set({
            message,
            choices: [
                { label: "Cancel", value: false },
                { label: confirmLabel, value: true },
            ],
            input: initial,
            resolve: (result, text) => resolve(result === true ? text ?? "" : null),
        });
    });
}

// Asks a question with a list of checkboxes. Resolves with the chosen value and which boxes are
// ticked, or null if dismissed.
export function checklistDialog<T>(message: string, items: ChecklistItem[], choices: DialogChoice<T>[]): Promise<{ value: T; checked: boolean[] } | null> {
    return new Promise(resolve => {
        dialogState.set({
            message,
            choices: choices as DialogChoice<unknown>[],
            checklist: items,
            resolve: (result, _text, checked) => resolve(result === null || result === undefined
                ? null
                : { value: result as T, checked: checked ?? items.map(i => i.checked) }),
        });
    });
}

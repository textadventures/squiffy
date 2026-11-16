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
    resolve: (result: unknown) => void;
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

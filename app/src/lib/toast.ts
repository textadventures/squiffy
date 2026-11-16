// Fire-and-forget notifications, rendered by Toast.svelte (mounted once in +layout.svelte).
import { writable } from "svelte/store";

export interface ToastMessage {
    id: number;
    text: string;
    kind: "error" | "info";
}

export const toasts = writable<ToastMessage[]>([]);

let nextId = 0;

export function showToast(text: string, kind: ToastMessage["kind"] = "error", durationMs = 6000): void {
    const id = ++nextId;
    toasts.update(list => [...list, { id, text, kind }]);
    setTimeout(() => dismissToast(id), durationMs);
}

export function dismissToast(id: number): void {
    toasts.update(list => list.filter(t => t.id !== id));
}

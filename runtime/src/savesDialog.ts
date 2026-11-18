import type { SavedGame, SquiffyApi } from "./types.js";
import { indexedDbSaveSlots, memorySaveSlots, type SaveSlot, type SaveSlots } from "./saveSlots.js";

// The dialog's text in English. The published page passes in squiffy.json's "strings", which
// use the same names (see PAGE_STRINGS in the compiler). [name] and [time] are filled in.
export const SAVES_STRINGS = {
    saves: "Saved games",
    saveName: "Name (optional)",
    save: "Save",
    noSaves: "No saved games yet.",
    savedGame: "Saved game",
    savedToday: "Today, [time]",
    savedYesterday: "Yesterday, [time]",
    load: "Load",
    loadConfirm: "Load \"[name]\"? You'll lose anything you've done since you last saved.",
    saveOptions: "Options for [name]",
    overwrite: "Overwrite",
    overwriteConfirm: "Overwrite \"[name]\"?",
    rename: "Rename",
    newName: "New name",
    saveToFile: "Save to file",
    loadFromFile: "Load from file",
    delete: "Delete",
    deleteConfirm: "Delete \"[name]\"? This can't be undone.",
    cancel: "Cancel",
    close: "Close",
    wrongStory: "This saved game is for a different story.",
    notASave: "This file isn't a saved game.",
    cantSave: "The game couldn't be saved. Try Save to file instead.",
};

export type SavesStringName = keyof typeof SAVES_STRINGS;

export interface SavesDialogOptions {
    // Where the player's saves are kept. By default, in the browser's IndexedDB under `key`.
    slots?: SaveSlots;
    // Which story the saves are for, when `slots` isn't given: the page's path by default
    key?: string;
    // The dialog's text, for a story in another language. Anything left out is in English.
    strings?: Partial<Record<string, string>>;
    // The name Save to file gives the file, before ".squiffy-save": the page's title by default
    fileName?: string;
    // Where the dialog goes in the page: the end of the body by default
    container?: HTMLElement;
}

export interface SavesDialog {
    element: HTMLDialogElement;
    open: () => Promise<void>;
    close: () => void;
}

export const SAVE_FILE_EXTENSION = ".squiffy-save";

const ICON_CLOSE = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M18 6 6 18M6 6l12 12\"/></svg>";
const ICON_OPTIONS = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"5\" cy=\"12\" r=\"1\"/><circle cx=\"12\" cy=\"12\" r=\"1\"/><circle cx=\"19\" cy=\"12\" r=\"1\"/></svg>";
const ICON_DOWNLOAD = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3\"/></svg>";
const ICON_UPLOAD = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12\"/></svg>";

let dialogCount = 0;

// "Today, 12:57", "Yesterday, 21:14", or the date and time for anything older
export function formatSaveTime(savedAt: string, strings: Record<SavesStringName, string> = SAVES_STRINGS, now = new Date()) {
    const date = new Date(savedAt);
    if (isNaN(date.getTime())) return "";
    const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
    if (daysAgo === 0) return strings.savedToday.replace("[time]", time);
    if (daysAgo === 1) return strings.savedYesterday.replace("[time]", time);
    const day = date.toLocaleDateString(undefined, {
        day: "numeric", month: "short",
        ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
    });
    return `${day}, ${time}`;
}

// The Saved games dialog: saves the game into a list of saves, which the player can load,
// overwrite, rename, save to a file or delete, and saves to and loads from a file. It's added to
// the page hidden, and open() shows it.
export function createSavesDialog(api: SquiffyApi, options: SavesDialogOptions = {}): SavesDialog {
    const strings: Record<SavesStringName, string> = { ...SAVES_STRINGS };
    for (const name of Object.keys(SAVES_STRINGS) as SavesStringName[]) {
        const value = options.strings?.[name];
        if (typeof value == "string") strings[name] = value;
    }
    const slots = options.slots ?? (typeof indexedDB != "undefined"
        ? indexedDbSaveSlots(options.key ?? window.location.pathname)
        : memorySaveSlots());
    const id = `squiffy-saves-${++dialogCount}`;

    const dialog = document.createElement("dialog");
    dialog.className = "squiffy-saves";
    dialog.setAttribute("aria-labelledby", `${id}-heading`);
    dialog.innerHTML = `
        <div class="squiffy-saves-header">
            <h2 id="${id}-heading"></h2>
            <button type="button" class="squiffy-saves-icon-button" data-close>${ICON_CLOSE}</button>
        </div>
        <p class="squiffy-saves-error" role="alert" hidden></p>
        <form class="squiffy-saves-new">
            <input type="text" autocomplete="off">
            <button type="submit" class="squiffy-saves-button squiffy-saves-primary"></button>
        </form>
        <ul class="squiffy-saves-list"></ul>
        <div class="squiffy-saves-footer">
            <button type="button" class="squiffy-saves-link" data-save-to-file>${ICON_DOWNLOAD}<span></span></button>
            <button type="button" class="squiffy-saves-link" data-load-from-file>${ICON_UPLOAD}<span></span></button>
            <input type="file" accept="${SAVE_FILE_EXTENSION},.json,application/json" hidden>
        </div>
        <div class="squiffy-saves-footer-confirm"></div>`;

    const $ = <T extends Element>(selector: string) => dialog.querySelector<T>(selector)!;
    $("h2").textContent = strings.saves;
    const closeButton = $<HTMLButtonElement>("[data-close]");
    closeButton.title = strings.close;
    closeButton.setAttribute("aria-label", strings.close);
    const error = $<HTMLParagraphElement>(".squiffy-saves-error");
    const form = $<HTMLFormElement>("form");
    const nameInput = $<HTMLInputElement>("form input");
    nameInput.placeholder = strings.saveName;
    nameInput.setAttribute("aria-label", strings.saveName);
    $("form button").textContent = strings.save;
    const list = $<HTMLUListElement>(".squiffy-saves-list");
    $("[data-save-to-file] span").textContent = strings.saveToFile;
    $("[data-load-from-file] span").textContent = strings.loadFromFile;
    const fileInput = $<HTMLInputElement>("input[type=file]");
    const footerConfirm = $<HTMLDivElement>(".squiffy-saves-footer-confirm");

    (options.container ?? document.body).appendChild(dialog);

    // Whether the player has done anything since they last saved or loaded, which loading a save
    // would lose. Squiffy saves automatically too, but that doesn't count: loading replaces it.
    // That's anything since the start of the story (which may be a game restored from earlier),
    // unless they've saved or loaded since. It's worked out when it's needed, as the dialog can be
    // made before the story begins.
    let savedOrLoaded = false;
    api.on("navigated", () => { savedOrLoaded = false; });
    const unsaved = () => !savedOrLoaded && api.canGoBack();

    let saves: SaveSlot[] = [];
    // Closes whatever's open inside the dialog (a question, a save's menu, or a rename), so
    // Escape can close that before it closes the dialog
    let cancelOpen: (() => void) | null = null;

    const showError = (message: string) => {
        error.textContent = message;
        error.hidden = false;
    };
    const hideError = () => {
        error.hidden = true;
    };

    const titleOf = (slot: SaveSlot) => slot.name || slot.save.summary || strings.savedGame;

    const metaOf = (slot: SaveSlot) =>
        [formatSaveTime(slot.save.savedAt, strings), slot.name && slot.save.summary].filter(Boolean).join(" · ");

    const rowOf = (slotId: number) => list.querySelector<HTMLLIElement>(`[data-slot="${slotId}"]`);

    function render() {
        list.replaceChildren();
        if (!saves.length) {
            const empty = document.createElement("li");
            empty.className = "squiffy-saves-empty";
            empty.textContent = strings.noSaves;
            list.appendChild(empty);
            return;
        }
        for (const slot of saves) {
            const title = titleOf(slot);
            const row = document.createElement("li");
            row.className = "squiffy-saves-row";
            row.dataset.slot = String(slot.id);
            row.innerHTML = `
                <div class="squiffy-saves-line">
                    <div class="squiffy-saves-info">
                        <div class="squiffy-saves-title" id="${id}-title-${slot.id}"></div>
                        <div class="squiffy-saves-meta"></div>
                    </div>
                    <button type="button" class="squiffy-saves-button" data-action="load" aria-describedby="${id}-title-${slot.id}"></button>
                    <div class="squiffy-saves-options">
                        <button type="button" class="squiffy-saves-icon-button" data-action="options" aria-haspopup="menu" aria-expanded="false" aria-controls="${id}-menu-${slot.id}">${ICON_OPTIONS}</button>
                        <div class="squiffy-saves-menu" id="${id}-menu-${slot.id}" role="menu" hidden>
                            <button type="button" role="menuitem" data-action="overwrite"></button>
                            <button type="button" role="menuitem" data-action="rename"></button>
                            <button type="button" role="menuitem" data-action="download"></button>
                            <button type="button" role="menuitem" data-action="delete" class="squiffy-saves-danger"></button>
                        </div>
                    </div>
                </div>`;
            const q = (selector: string) => row.querySelector<HTMLElement>(selector)!;
            q(".squiffy-saves-title").textContent = title;
            const meta = metaOf(slot);
            if (meta) q(".squiffy-saves-meta").textContent = meta;
            else q(".squiffy-saves-meta").remove();
            q("[data-action=load]").textContent = strings.load;
            const options = q("[data-action=options]");
            options.title = strings.saveOptions.replace("[name]", title);
            options.setAttribute("aria-label", options.title);
            q("[data-action=overwrite]").textContent = strings.overwrite;
            q("[data-action=rename]").textContent = strings.rename;
            q("[data-action=download]").textContent = strings.saveToFile;
            q("[data-action=delete]").textContent = strings.delete;
            list.appendChild(row);
        }
    }

    async function refresh() {
        try {
            saves = await slots.list();
        }
        catch {
            saves = [];
            showError(strings.cantSave);
        }
        render();
    }

    // Asks a question inside the dialog, under `container`, rather than with confirm(). Resolves
    // true if the player goes ahead.
    function confirmInDialog(container: HTMLElement, message: string, actionLabel: string, danger = false) {
        cancelOpen?.();
        const box = document.createElement("div");
        box.className = "squiffy-saves-confirm";
        box.setAttribute("role", "group");
        box.innerHTML = `<p id="${id}-confirm"></p>
            <div class="squiffy-saves-confirm-buttons">
                <button type="button" class="squiffy-saves-button" data-answer="no"></button>
                <button type="button" class="squiffy-saves-button ${danger ? "squiffy-saves-danger-button" : "squiffy-saves-primary"}" data-answer="yes" aria-describedby="${id}-confirm"></button>
            </div>`;
        box.setAttribute("aria-labelledby", `${id}-confirm`);
        box.querySelector("p")!.textContent = message;
        const no = box.querySelector<HTMLButtonElement>("[data-answer=no]")!;
        const yes = box.querySelector<HTMLButtonElement>("[data-answer=yes]")!;
        no.textContent = strings.cancel;
        yes.textContent = actionLabel;
        container.appendChild(box);
        return new Promise<boolean>(resolve => {
            const finish = (answer: boolean) => {
                cancelOpen = null;
                box.remove();
                resolve(answer);
            };
            cancelOpen = () => finish(false);
            no.addEventListener("click", () => finish(false));
            yes.addEventListener("click", () => finish(true));
            yes.focus();
        });
    }

    // A save's menu goes in the top layer as a popover, where the browser has them, so the list
    // scrolling doesn't cut it off. It's under its ⋯ button, or above it if there's no room below.
    const popovers = typeof HTMLElement.prototype.showPopover == "function";

    function showMenu(menu: HTMLElement, button: HTMLElement) {
        if (!popovers) {
            menu.hidden = false;
            return;
        }
        menu.hidden = false;
        menu.popover = "manual";
        menu.showPopover();
        const rect = button.getBoundingClientRect();
        const { width, height } = menu.getBoundingClientRect();
        const below = rect.bottom + 4;
        menu.style.top = `${below + height > window.innerHeight - 8 ? Math.max(8, rect.top - 4 - height) : below}px`;
        menu.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - 8 - width))}px`;
    }

    function hideMenu(menu: HTMLElement) {
        if (popovers && menu.matches(":popover-open")) menu.hidePopover();
        menu.hidden = true;
    }

    // A save's menu, opened by its ⋯ button
    function openMenu(button: HTMLElement) {
        const menu = document.getElementById(button.getAttribute("aria-controls")!)!;
        const wasOpen = button.getAttribute("aria-expanded") == "true";
        cancelOpen?.();
        if (wasOpen) return;
        showMenu(menu, button);
        button.setAttribute("aria-expanded", "true");
        const items = [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")];
        items[0].focus();

        const close = (focusButton: boolean) => {
            cancelOpen = null;
            hideMenu(menu);
            button.setAttribute("aria-expanded", "false");
            menu.removeEventListener("keydown", onKey);
            dialog.removeEventListener("pointerdown", onPointerDown);
            if (focusButton) button.focus();
        };
        const onKey = (e: KeyboardEvent) => {
            const index = items.indexOf(document.activeElement as HTMLElement);
            const next = ({ ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 } as Record<string, number>)[e.key];
            if (next !== undefined) {
                e.preventDefault();
                items[(next + items.length) % items.length].focus();
            }
            else if (e.key == "Tab") {
                close(false);
            }
        };
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as Node;
            if (!menu.contains(target) && !button.contains(target)) close(false);
        };
        menu.addEventListener("keydown", onKey);
        dialog.addEventListener("pointerdown", onPointerDown);
        cancelOpen = () => close(true);
    }

    // Turns a save's title into a text box. Enter or leaving the box keeps the new name (an empty
    // one makes the save unnamed again), and Escape keeps the old one.
    function startRename(slot: SaveSlot) {
        const title = rowOf(slot.id)?.querySelector(".squiffy-saves-title");
        if (!title) return;
        const input = document.createElement("input");
        input.type = "text";
        input.className = "squiffy-saves-rename";
        input.autocomplete = "off";
        input.value = slot.name ?? "";
        input.placeholder = titleOf(slot);
        input.setAttribute("aria-label", strings.newName);
        title.replaceWith(input);
        input.focus();
        input.select();

        let finished = false;
        const finish = async (keep: boolean) => {
            if (finished) return;
            finished = true;
            cancelOpen = null;
            const name = input.value.trim() || null;
            if (keep && name !== slot.name) {
                await slots.rename(slot.id, name).catch(() => showError(strings.cantSave));
            }
            await refresh();
            rowOf(slot.id)?.querySelector<HTMLElement>("[data-action=load]")?.focus();
        };
        cancelOpen = () => { finish(false); };
        input.addEventListener("keydown", e => {
            if (e.key == "Enter") {
                e.preventDefault();
                finish(true);
            }
        });
        input.addEventListener("blur", () => finish(true));
    }

    function fileName() {
        const name = (options.fileName ?? document.title).replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
        return (name || "story") + SAVE_FILE_EXTENSION;
    }

    function download(save: SavedGame) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(save)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName();
        dialog.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    async function load(save: unknown) {
        const result = await api.loadSave(save as SavedGame);
        if (!result.success) {
            showError(strings[result.error]);
            return;
        }
        savedOrLoaded = true;
        dialog.close();
    }

    // Escape closes whatever's open in the dialog first
    dialog.addEventListener("cancel", e => {
        if (cancelOpen) {
            e.preventDefault();
            cancelOpen();
        }
    });

    closeButton.addEventListener("click", () => dialog.close());

    form.addEventListener("submit", async e => {
        e.preventDefault();
        hideError();
        cancelOpen?.();
        try {
            await slots.add(api.getSave(), nameInput.value);
            savedOrLoaded = true;
            nameInput.value = "";
        }
        catch {
            showError(strings.cantSave);
        }
        await refresh();
        nameInput.focus();
    });

    list.addEventListener("click", async e => {
        const button = (e.target as Element).closest<HTMLElement>("[data-action]");
        const row = button?.closest<HTMLLIElement>("[data-slot]");
        if (!button || !row) return;
        const slot = saves.find(s => s.id === Number(row.dataset.slot));
        if (!slot) return;
        const action = button.dataset.action;
        if (action == "options") {
            openMenu(button);
            return;
        }
        if (button.getAttribute("role") == "menuitem") cancelOpen?.();
        hideError();
        const title = titleOf(slot);

        if (action == "load") {
            if (unsaved() && !await confirmInDialog(row, strings.loadConfirm.replace("[name]", title), strings.load)) {
                button.focus();
                return;
            }
            const latest = await slots.get(slot.id).catch(() => null);
            if (latest) await load(latest.save);
        }
        else if (action == "overwrite") {
            if (!await confirmInDialog(row, strings.overwriteConfirm.replace("[name]", title), strings.overwrite)) return;
            try {
                await slots.overwrite(slot.id, api.getSave());
                savedOrLoaded = true;
            }
            catch {
                showError(strings.cantSave);
            }
            await refresh();
            rowOf(slot.id)?.querySelector<HTMLElement>("[data-action=load]")?.focus();
        }
        else if (action == "rename") {
            startRename(slot);
        }
        else if (action == "download") {
            download(slot.save);
        }
        else if (action == "delete") {
            if (!await confirmInDialog(row, strings.deleteConfirm.replace("[name]", title), strings.delete, true)) return;
            await slots.delete(slot.id).catch(() => showError(strings.cantSave));
            await refresh();
            nameInput.focus();
        }
    });

    $("[data-save-to-file]").addEventListener("click", () => {
        hideError();
        download(api.getSave());
        savedOrLoaded = true;
    });

    $("[data-load-from-file]").addEventListener("click", () => {
        hideError();
        fileInput.click();
    });

    fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        fileInput.value = "";
        if (!file) return;
        let save: unknown;
        try {
            save = JSON.parse(await file.text());
        }
        catch {
            showError(strings.notASave);
            return;
        }
        if (unsaved() && !await confirmInDialog(footerConfirm, strings.loadConfirm.replace("[name]", file.name), strings.load)) {
            return;
        }
        await load(save);
    });

    return {
        element: dialog,
        async open() {
            hideError();
            cancelOpen?.();
            nameInput.value = "";
            // Shown straight away, so the player can type a name while the saves are listed
            if (!dialog.open) dialog.showModal();
            nameInput.focus();
            await refresh();
        },
        close() {
            cancelOpen?.();
            dialog.close();
        },
    };
}

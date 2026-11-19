// The desktop app's New story dialog (NewStoryDialog.svelte, mounted once in +layout.svelte): the
// author names the story, and it's made in a new folder of that name, in a location the desktop
// app keeps (Documents/Squiffy unless they choose another), as Quest Viva does.
import { writable } from "svelte/store";
import type { OpenedRoot } from "./desktop.js";

export interface NewStory {
    root: OpenedRoot;
    title: string;
}

export const newStoryDialogState = writable<{ resolve: (result: NewStory | null) => void } | null>(null);

/** Resolves with the new, empty folder and the story's title, or null if cancelled */
export function newStoryDialog(): Promise<NewStory | null> {
    return new Promise(resolve => newStoryDialogState.set({ resolve }));
}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** A story's title, tidied: one line, without extra spaces */
export function tidyTitle(title: string): string {
    return title.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * The folder for a story with this title: the title without the characters some OS won't have in
 * a name, and without leading or trailing dots (hidden on a Mac, dropped by Windows). Empty if
 * nothing's left. The desktop app checks the same rules (isFolderName in desktop/src/new-story.ts).
 */
export function folderNameFor(title: string): string {
    // eslint-disable-next-line no-control-regex
    let name = tidyTitle(title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")).slice(0, 100);
    name = name.replace(/^[.\s]+|[.\s]+$/g, "");
    return RESERVED.test(name) ? `${name} story` : name;
}

/** The new story's text, with its title */
export function newStoryText(template: string, title: string): string {
    return template.replace(/^@title .*$/m, `@title ${tidyTitle(title)}`);
}

// Opening another story from inside the editor (#711): the toolbar's File menu in the browser
// (the desktop app has its own File menu, in desktop-shell.ts), and a Twine story pasted into the
// script, converted into a new story. The open story is saved and closed, and the editor page is
// left and come back to, so it starts afresh, as openInEditor does in the desktop app.
import { goto } from "$app/navigation";
import { base } from "./base-path.js";
import { openInEditor } from "./desktop-shell.js";
import {
    browserStoryFromTwine, closeProject, importFile, isDesktop, newBrowserStory, openFolder, pickDesktopFolderForTwine,
} from "./project.svelte.js";
import { showToast } from "./toast.js";
import type { ConvertedTwine } from "./twine-import.js";

let busy = false;

async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    try {
        await action();
    } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
    } finally {
        busy = false;
    }
}

async function edit(kind: "story" | "folder", id: string) {
    await goto(`${base}/`, { replaceState: true });
    await goto(`${base}/edit?${kind}=${encodeURIComponent(id)}`);
}

// A story in this browser, once it's made
async function editBrowserStory(id: string | null) {
    if (!id) return;
    await closeProject();
    await edit("story", id);
}

export const newStory = () => run(async () => editBrowserStory(await newBrowserStory()));

// A .squiffy file, a project zip, or a Twine story or Quest gamebook to convert, as the home
// page's Open file
export const openFile = (file: File) => run(async () => editBrowserStory(await importFile(file)));

export const openStoryFolder = () => run(async () => {
    const id = await openFolder(closeProject);
    if (id) await edit("folder", id);
});

// A Twine story pasted into the script, converted: a new story in this browser, or in the
// desktop app, in a new folder
export function openConvertedTwine(converted: ConvertedTwine) {
    const name = converted.title ? `the Squiffy version of "${converted.title}"` : "the converted Twine story";
    if (isDesktop) return openInEditor(() => pickDesktopFolderForTwine(converted, name));
    return run(async () => editBrowserStory(await browserStoryFromTwine(converted)));
}

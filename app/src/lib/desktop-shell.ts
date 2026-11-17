// The desktop app's native menu and window (#276): File menu commands, Open Recent and files the
// OS asks the app to open, and saving before the window closes. Set up once, in +layout.svelte.
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { base } from "./base-path.js";
import { desktopApi, type MenuAction } from "./desktop.js";
import {
    closeProject, openPicked, pickDesktopFile, pickDesktopFolder, pickDesktopNewStory, pickDesktopRecent, project,
    type PickedFolder,
} from "./project.svelte.js";
import { settings } from "./settings.svelte.js";
import { watchForDesktopUpdates } from "./desktop-updates.svelte.js";
import { showToast } from "./toast.js";

let busy = false;

// Picks a folder, then saves and closes the open story, and opens the new one. The editor page
// is left and come back to, so it starts afresh for the new story.
// `missing` is said if nothing's picked, for a pick with no dialog to cancel.
export async function openInEditor(pick: () => Promise<PickedFolder | null>, missing?: string): Promise<void> {
    if (busy) return;
    busy = true;
    try {
        const picked = await pick();
        if (!picked) {
            if (missing) showToast(missing, "info");
            return;
        }
        await closeProject();
        if (page.route.id === "/edit") await goto(`${base}/`, { replaceState: true });
        const id = await openPicked(picked);
        await goto(`${base}/edit?folder=${encodeURIComponent(id)}`);
    } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
    } finally {
        busy = false;
    }
}

async function handleAction(action: MenuAction) {
    switch (action) {
        case "new-story":
            return openInEditor(pickDesktopNewStory);
        case "open-folder":
            return openInEditor(pickDesktopFolder);
        case "open-file":
            return openInEditor(pickDesktopFile);
        case "save":
            return project.current?.save();
        case "close-story":
            await closeProject();
            return goto(`${base}/`);
        case "settings":
            settings.open = true;
            return;
    }
}

/** Returns a function that stops listening */
export function initDesktopShell(): () => void {
    const api = desktopApi();
    if (!api) return () => {};
    const { desktop } = api;
    const stops = [
        desktop.menu.onAction(action => void handleAction(action)),
        desktop.menu.onOpenRecent(id => {
            // Already open: nothing to do
            if (project.current?.source.kind === "folder" && project.current.source.id === id && page.route.id === "/edit") return;
            void openInEditor(() => pickDesktopRecent(id), "That folder has moved or been deleted.");
        }),
        desktop.onBeforeClose(async () => {
            await project.current?.save();
        }),
        watchForDesktopUpdates(),
    ];
    return () => stops.forEach(stop => stop());
}

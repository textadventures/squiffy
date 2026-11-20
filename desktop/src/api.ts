// What the preload script exposes to the editor as window.squiffyDesktop, alongside project-fs's
// window.projectFs. The editor has its own copy of these types (app/src/lib/desktop.ts), since
// it doesn't depend on this package: keep the two in step.

export const CHANNEL_PREFIX = "squiffyDesktop:";

export interface RecentFolderInfo {
    id: string;
    /** The folder's name */
    name: string;
    /** The folder's absolute path, for display */
    displayPath: string;
    mainFile: string;
    lastOpened: number;
}

export interface OpenedRecentFolder {
    rootId: string;
    name: string;
    displayPath: string;
    mainFile: string;
}

/** What New story's Create did: a new, empty folder, approved for the window, or why not */
export type NewStoryResult =
    | { ok: true; root: OpenedRoot }
    | { ok: false; reason: "exists" | "invalid-name" };

/** A project-fs root, as approveRoot returns it */
export interface OpenedRoot {
    rootId: string;
    name: string;
    displayPath: string;
}

/** Native menu commands the editor carries out */
export type MenuAction = "new-story" | "open-folder" | "open-file" | "save" | "close-story" | "settings" | "undo" | "redo" | "keyboard-shortcuts";

export interface SquiffyDesktopApi {
    platform: "mac" | "windows" | "linux";
    recent: {
        list(): Promise<RecentFolderInfo[]>;
        /** Approves the folder for this window. Null if it's not in the list or has gone. */
        open(id: string): Promise<OpenedRecentFolder | null>;
        /** Adds a folder this window holds (by its project-fs root id) to the list. Returns its id there. */
        remember(rootId: string, mainFile: string): Promise<string>;
        update(id: string, mainFile: string): Promise<void>;
        forget(id: string): Promise<void>;
        onChanged(listener: () => void): () => void;
    };
    /** New story makes a folder named after the story, in a location the main process keeps */
    newStory: {
        /** Where it'll go: the last location a story was made in, or Documents/Squiffy. For display. */
        location(): Promise<string>;
        /** The author picks another location. Null if cancelled. */
        chooseLocation(): Promise<string | null>;
        /** Makes the folder, which has to be new, from a name made by the editor's folderNameFor() */
        create(folderName: string): Promise<NewStoryResult>;
    };
    menu: {
        onAction(listener: (action: MenuAction) => void): () => void;
        /** A folder to open from the recent list: Open Recent, or a file the OS asked the app to open */
        onOpenRecent(listener: (id: string) => void): () => void;
    };
    /**
     * Shows a file in the folder that holds it, in Finder, Explorer or the file manager, by its
     * path in a project-fs root the window holds. An empty path opens the root folder itself.
     */
    showInFolder(rootId: string, path: string): Promise<void>;
    /** The window's about to close: the editor saves, then calls the function it's given. */
    onBeforeClose(listener: () => Promise<void>): () => void;
}

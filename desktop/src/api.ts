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

/** Native menu commands the editor carries out */
export type MenuAction = "new-story" | "open-folder" | "open-file" | "save" | "close-story" | "settings";

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
    menu: {
        onAction(listener: (action: MenuAction) => void): () => void;
        /** A folder to open from the recent list: Open Recent, or a file the OS asked the app to open */
        onOpenRecent(listener: (id: string) => void): () => void;
    };
    /** The window's about to close: the editor saves, then calls the function it's given. */
    onBeforeClose(listener: () => Promise<void>): () => void;
}

// The desktop app's API (#276): window.squiffyDesktop, from desktop/src/preload.ts. A copy of
// the types in desktop/src/api.ts, since the app doesn't depend on that package: keep the two in
// step. project-fs's own bridge is window.projectFs.
import type { ProjectFsBridge } from "@textadventures/project-fs";
import { isElectron } from "./runtime.js";

export interface RecentFolderInfo {
    id: string;
    name: string;
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

export interface OpenedRoot {
    rootId: string;
    name: string;
    displayPath: string;
}

export type NewStoryResult =
    | { ok: true; root: OpenedRoot }
    | { ok: false; reason: "exists" | "invalid-name" };

export type MenuAction = "new-story" | "open-folder" | "open-file" | "save" | "close-story" | "settings" | "undo" | "redo";

export interface SquiffyDesktopApi {
    platform: "mac" | "windows" | "linux";
    recent: {
        list(): Promise<RecentFolderInfo[]>;
        open(id: string): Promise<OpenedRecentFolder | null>;
        remember(rootId: string, mainFile: string): Promise<string>;
        update(id: string, mainFile: string): Promise<void>;
        forget(id: string): Promise<void>;
        onChanged(listener: () => void): () => void;
    };
    newStory: {
        location(): Promise<string>;
        chooseLocation(): Promise<string | null>;
        create(folderName: string): Promise<NewStoryResult>;
    };
    menu: {
        onAction(listener: (action: MenuAction) => void): () => void;
        onOpenRecent(listener: (id: string) => void): () => void;
    };
    onBeforeClose(listener: () => Promise<void>): () => void;
}

declare global {
    interface Window {
        projectFs?: ProjectFsBridge;
        squiffyDesktop?: SquiffyDesktopApi;
    }
}

/** The desktop API, or null in a browser */
export function desktopApi(): { desktop: SquiffyDesktopApi; projectFs: ProjectFsBridge } | null {
    if (!isElectron() || !window.squiffyDesktop || !window.projectFs) return null;
    return { desktop: window.squiffyDesktop, projectFs: window.projectFs };
}

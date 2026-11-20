import { ProjectFsError, type ProjectFsErrorCode } from "../errors.js";
import type { FileChange, FileEntry, FileTypeFilter } from "../types.js";

// What crosses the Electron IPC boundary. The renderer only ever refers to a project by an
// opaque root id that the main process handed out after the user picked a folder or file in a
// native dialog (or the main process approved it itself). It never sends an absolute path.

export const CHANNEL_PREFIX = "projectFs:";
export const CHANGE_EVENT = `${CHANNEL_PREFIX}changed`;

export interface RootInfo {
    rootId: string;
    /** Folder name, for display. */
    name: string;
    /** Absolute path, for display only (e.g. "Show in Finder" or a recent list). */
    displayPath: string;
}

export interface PickFolderOptions {
    title?: string;
    /** macOS shows this instead of the title. */
    message?: string;
    buttonLabel?: string;
}

export interface PickFileOptions extends PickFolderOptions {
    filters?: FileTypeFilter[];
}

/** The API the preload script exposes to the renderer (window.projectFs by default). */
export interface ProjectFsBridge {
    /** The user picks a folder. Null if cancelled. */
    pickFolder(options?: PickFolderOptions): Promise<RootInfo | null>;
    /** The user picks a file; its folder becomes the root and the file the main file. */
    pickFile(options?: PickFileOptions): Promise<(RootInfo & { mainFile: string }) | null>;
    /** Save As: the user picks (or creates) a folder to become a new root. */
    pickNewFolder(options?: PickFolderOptions): Promise<RootInfo | null>;
    /** Forgets a root; its id stops working. */
    release(rootId: string): Promise<void>;

    list(rootId: string, dir?: string): Promise<FileEntry[]>;
    read(rootId: string, path: string): Promise<Uint8Array>;
    write(rootId: string, path: string, data: Uint8Array | string): Promise<void>;
    delete(rootId: string, path: string): Promise<void>;
    exists(rootId: string, path: string): Promise<boolean>;
    watch(rootId: string): Promise<void>;
    unwatch(rootId: string): Promise<void>;
    /** Subscribes to change events for every watched root. Returns an unsubscribe function. */
    onChange(listener: (rootId: string, changes: FileChange[]) => void): () => void;
}

/**
 * Handlers reply with an envelope instead of throwing, because Electron flattens a thrown
 * error to "Error invoking remote method ...: Error: <message>" and the code would be lost.
 */
export type Reply<T> = { ok: true; value: T } | { ok: false; code: ProjectFsErrorCode; message: string };

export function unwrap<T>(reply: Reply<T>): T {
    if (reply.ok) return reply.value;
    throw new ProjectFsError(reply.code, `[project-fs:${reply.code}] ${reply.message}`);
}

const CODE_TAG = /\[project-fs:([A-Z_]+)\] /;

/**
 * The preload script's errors reach the page through contextBridge, which passes on only an
 * error's message, not its class or code. So unwrap() puts the code in the message too, and the
 * renderer calls this to turn it back into a ProjectFsError (with the tag taken out).
 */
export function fromBridgeError(err: unknown): unknown {
    const message = err instanceof Error ? err.message : typeof err === "string" ? err : undefined;
    const match = message === undefined ? null : CODE_TAG.exec(message);
    if (!match || message === undefined) return err;
    return new ProjectFsError(match[1] as ProjectFsErrorCode, message.slice(match.index + match[0].length));
}

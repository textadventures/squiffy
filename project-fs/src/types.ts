export interface FileEntry {
    /** Project path, relative to the root, POSIX separators, NFC. */
    path: string;
    size?: number;
    /** Milliseconds since the epoch, when the back end knows it. */
    lastModified?: number;
}

export interface FileChange {
    path: string;
    /** "changed" covers creation too. */
    kind: "changed" | "deleted";
}

export interface FileUrl {
    url: string;
    /** Frees the URL (e.g. revokes a blob: URL). Safe to call more than once. */
    release(): void;
}

/**
 * A project: a rooted tree of files, addressed by relative POSIX paths.
 *
 * - Directories are implicit. write() creates parents, delete() removes directories it leaves
 *   empty, and list() returns files only.
 * - Paths are case-sensitive and case-preserving, and a write that would create a path differing
 *   only in case from an existing one fails with CASE_CONFLICT. That keeps a project portable
 *   between case-insensitive disks (macOS, Windows) and case-sensitive stores (OPFS, Linux).
 * - Which file is the "main" one is not the file system's business: callers keep that pointer
 *   alongside it.
 */
export interface ProjectFileSystem {
    /** Display name of the root (the folder name, the project name). */
    readonly name: string;

    /**
     * Every file under `dir` (default: the whole project), recursively, sorted by path.
     * A missing directory gives []. Hides OS junk files and skips hidden directories and
     * node_modules (see isJunkFile / isSkippedDirectory).
     */
    list(dir?: string): Promise<FileEntry[]>;
    read(path: string): Promise<Uint8Array>;
    /** Decodes as UTF-8, dropping a byte-order mark. */
    readText(path: string): Promise<string>;
    /** Creates or replaces the file, creating parent directories. Strings are written as UTF-8. */
    write(path: string, data: Uint8Array | string): Promise<void>;
    /** Throws NOT_FOUND if there's no such file. */
    delete(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;

    /** A URL the page can load the file from, e.g. for <img src>. */
    url?(path: string): Promise<FileUrl>;
    /**
     * Reports changes made by anything other than this instance (another program, another
     * window). Returns an unsubscribe function.
     */
    watch?(listener: (changes: FileChange[]) => void): () => void;
}

/** A file-type filter, as passed to pickers. Extensions include the dot: [".squiffy"]. */
export interface FileTypeFilter {
    description: string;
    extensions: string[];
    /** MIME type used for the File System Access picker's `accept` map. */
    mimeType?: string;
}

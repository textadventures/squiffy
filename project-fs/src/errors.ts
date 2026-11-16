export type ProjectFsErrorCode =
    /** The path is absolute, climbs out with "..", or has a segment that isn't portable. */
    | "INVALID_PATH"
    | "NOT_FOUND"
    /** A file was expected but the path is a directory. */
    | "NOT_A_FILE"
    /** A directory was expected (as a parent, or for list()) but the path is a file. */
    | "NOT_A_DIRECTORY"
    /** A write would create a path that differs only in case from an existing one. */
    | "CASE_CONFLICT"
    /** A resolved path (e.g. through a symlink) is outside the project root. */
    | "OUTSIDE_ROOT"
    /** Electron: the root ID isn't one the main process approved for this window. */
    | "UNKNOWN_ROOT"
    | "NOT_SUPPORTED"
    | "IO";

/** Every error this layer throws on purpose is a ProjectFsError, so callers can switch on `code`. */
export class ProjectFsError extends Error {
    constructor(
        readonly code: ProjectFsErrorCode,
        message: string,
        readonly path?: string,
    ) {
        super(message);
        this.name = "ProjectFsError";
    }
}

export function isProjectFsError(err: unknown, code?: ProjectFsErrorCode): err is ProjectFsError {
    return err instanceof ProjectFsError && (code === undefined || err.code === code);
}

export const notFound = (path: string) => new ProjectFsError("NOT_FOUND", `File not found: ${path}`, path);

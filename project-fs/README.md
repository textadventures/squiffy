# @textadventures/project-fs

A file system layer over a **rooted project tree**, for the Squiffy 7 editor (#278), the desktop app (#276), multi-file projects (#118) and images (#73). Forked from Quest Viva's `src/AppShell/src/lib/filesystem/` and reshaped (see #215).

It has **no Squiffy imports**, so it can become a standalone package later (working name `@textadventures/satchel`) without changes. For now it's a private workspace, versioned with the rest of the repo.

## The model

```ts
interface ProjectFileSystem {
    readonly name: string;
    list(dir?: string): Promise<FileEntry[]>;   // files only, recursive, sorted
    read(path: string): Promise<Uint8Array>;
    readText(path: string): Promise<string>;
    write(path: string, data: Uint8Array | string): Promise<void>;
    delete(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    url?(path: string): Promise<FileUrl>;        // blob: URL + release()
    watch?(listener): () => void;                // external changes only
}
```

- **Paths** are relative, POSIX-style and NFC (`chapters/one.squiffy`). `parsePath()` rejects absolute and drive paths, `..`, backslashes, control characters, characters Windows forbids (including `:`, which also blocks NTFS alternate data streams), Windows device names (`con`, `aux.txt`) and names ending in a dot or space. A leading `./` is dropped.
- **Directories are implicit.** `write()` creates parents and `delete()` removes directories it leaves empty.
- **The main file is a pointer the caller keeps**, not part of the file system.
- `list()` hides OS junk (`.DS_Store`, `._*`, `Thumbs.db`, `desktop.ini`) and doesn't descend into hidden directories or `node_modules`. They're still readable and writable by explicit path.

### Case sensitivity

macOS and Windows disks are case-insensitive, while OPFS and Linux are case-sensitive. To make a project behave the same everywhere:

- **Paths are case-sensitive and case-preserving on every back end.** Lookups compare against the names the back end actually stores, so `read("README.txt")` is `NOT_FOUND` when the file is `Readme.txt`, even on a Mac.
- **A write that would create a path differing only in case from an existing one fails with `CASE_CONFLICT`**, at any level (`assets/x.png` when `Assets/` exists). So no project can hold two names that would collide on a case-insensitive disk, and it can move between OPFS, a Mac folder and a Linux folder unchanged.
- `moveFile()` handles case-only renames through a temporary name.

Names are also compared in NFC, since HFS+ returns NFD from directory listings.

## Adapters

| Adapter | Where | Notes |
|---|---|---|
| `MemoryFileSystem` | anywhere | Tests, unsaved projects. Instances sharing a `MemoryStore` see each other's writes as external changes. |
| `DirectoryHandleFileSystem` + `fsaOpener` | Chromium | File System Access: `openFolder()`, `pickNewRoot()` (Save As), `reopen(handle)` for stored handles. The browser only grants folders, so the main file is picked from the folder (`findFiles()`). |
| `OpfsProjectStore` | all modern browsers | `listProjects` / `create` / `open` / `rename` / `delete`, and opaque per-project `getMeta`/`setMeta` JSON kept beside the tree (`projects/<id>/meta.json`, `projects/<id>/files/...`). Writes go through a worker where `createWritable()` is missing (Safari). |
| `NodeFileSystem` (`/node`) | Node | Used by the Electron main process. Could later replace `cli/src/external-files.ts`. |
| Electron (`/electron-main`, `/electron-preload`, `ElectronFileSystem`) | Electron | See below. |

Openers return file systems but are separate from them. File-type filters (`FileTypeFilter`) are always passed in by the caller. Save As means picking a new root and then calling `copyProject()`.

## Electron

```ts
// main
import { registerProjectFsHandlers } from "@textadventures/project-fs/electron-main";
const projectFs = registerProjectFsHandlers({ ipcMain, dialog });

// preload
import { exposeProjectFs } from "@textadventures/project-fs/electron-preload";
exposeProjectFs(contextBridge, ipcRenderer); // window.projectFs

// renderer
import { electronOpener } from "@textadventures/project-fs";
const opened = await electronOpener(window.projectFs).openFile({ filters });
```

This part is security-sensitive:

- **The renderer never sends an absolute path.** A root is approved only by a native dialog in the main process, or by `approveRoot()`, which the main process calls itself for paths it trusts (a recent list it keeps, a command-line argument). The renderer gets back an opaque random `rootId`.
- **`rootPath(sender, rootId)`** gives the main process the real path of a root that window holds, for its own bookkeeping (the desktop app's recent folders). A root id from the renderer can be trusted that way, where a path from it can't.
- **Root ids are scoped per window.** An id from one window gets `UNKNOWN_ROOT` in another, and a window's ids are dropped when it closes or calls `release()`.
- **Every argument is untrusted.** Types are checked, and paths go through `parsePath()` in the main process, independently of the renderer's own checks.
- **Symlinks can't lead outside.** Before every fs call, the deepest existing part of the target path is resolved with `realpath()` and must be inside the root's realpath. A dangling symlink is refused, since writing through it would create its target wherever that is. Symlinked directories aren't followed at all, and symlinked files are only visible when they point inside the root.
- **Errors keep their codes but drop Node's messages**, which contain absolute paths.

The main-process code depends on structural stand-ins for `ipcMain`, `dialog` and `contextBridge`, not on the `electron` package.

## Tests

`src/test/conformance.ts` is a shared suite that every adapter runs. All of it runs in Node (`npm test`):

- **In-memory**: directly.
- **File System Access**: against `src/test/fake-fsa.ts`, an in-memory implementation of the handle API, in both a case-sensitive mode and a case-insensitive mode that behaves like a macOS or Windows folder.
- **OPFS store**: against the same fakes, once with `createWritable()` and once in Safari mode, where writes go through the worker's own handler (`opfs/writer-core.ts`) via an in-process stand-in for the `Worker`.
- **Node**: against a temp directory, including `watch()` on the real file system, plus symlink and traversal tests.
- **Electron**: the renderer adapter, preload bridge and main-process handlers wired together through fake IPC (which structured-clones like the real thing) against a temp directory. Separate tests call the channels directly, as a compromised renderer could.

What the fakes can't cover, and needs checking in real browsers once the rebuilt editor uses it: real `showDirectoryPicker` permission prompts, the worker actually loading in Safari (`new URL("./writer.worker.js", import.meta.url)`), and whether a browser's own File System Access implementation matches names case-insensitively on a Mac. The layer doesn't rely on that, since it compares against listed names.

## Notes for extraction

- If this becomes a published package, inline the OPFS worker (a Blob URL): Vite's dependency pre-bundling can break `new URL(..., import.meta.url)` worker references in `node_modules`. `OpfsProjectStore` already takes a `createWorker` option.
- Port by hand any fix to the parts Quest Viva's copy shares, especially the Electron path checks and Safari/OPFS quirks. Quest's own Electron `fs:*` handlers accept any absolute path from the renderer, which this fork deliberately doesn't.

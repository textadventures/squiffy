// Browser-safe entry point. Node and Electron main-process parts are separate entry points
// ("./node", "./electron-main", "./electron-preload"), so a browser bundle never pulls in node:fs.
export * from "./errors.js";
export * from "./paths.js";
export * from "./types.js";
export { guessMimeType } from "./mime.js";
export { TreeFileSystem, ChangeEmitter, blobUrl, type DirEntry, type FileStat } from "./base.js";
export { MemoryFileSystem, MemoryStore } from "./memory.js";
export { DirectoryHandleFileSystem, writableStreamWriter, type HandleWriter } from "./handle.js";
export { fsaOpener, hasFileSystemAccess, ensurePermission, toFsaAcceptTypes, type FsaPickOptions } from "./fsa.js";
export { OpfsProjectStore, type OpfsProjectStoreOptions, type StoredProject } from "./opfs/store.js";
export { supportsMainThreadWrite } from "./opfs/writer.js";
export { ElectronFileSystem, electronOpener } from "./electron/renderer.js";
export type { ProjectFsBridge, RootInfo, PickFileOptions, PickFolderOptions } from "./electron/protocol.js";
export { findFiles, copyProject, moveFile } from "./util.js";

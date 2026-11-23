// The extension's own requests between the client (in the extension host) and the language
// server, besides LSP's. The server reads files through the client, with VS Code's workspace.fs,
// so it works the same on the desktop and the web, and with files that aren't on disk.

import type { PreviewStory } from "squiffy-compiler/language-service";

// Client -> server

// The story a file is part of, compiled for the preview
export const PREVIEW_STORY = "squiffy/previewStory";
export interface PreviewStoryParams { uri: string }
export type PreviewStoryResult = PreviewStory & {
    // The folder the story's assets are found from: the main file's
    root: string;
};

// The story a file is part of, built to be published: the packager's text files (index.html,
// story.js and the page's stylesheets), and the folder its assets are found from. The client
// copies the assets in, or zips the lot, as binary files are better read there than sent here.
export const EXPORT_STORY = "squiffy/exportStory";
export interface ExportStoryParams { uri: string }
export type ExportStoryResult =
    | { success: true; files: Record<string, string>; root: string; title?: string }
    | { success: false; errors: string[] };

// The section (and passage) at a position, to start the preview there
export const SECTION_AT = "squiffy/sectionAt";
export interface SectionAtParams { uri: string; position: { line: number; character: number } }
export type SectionAtResult = { section: string; passage?: string } | null;

// Makes a file the main file of the story in its folder, when there's no squiffy.json
export const SET_MAIN_FILE = "squiffy/setMainFile";
export interface SetMainFileParams { uri: string }

// Server -> client

// The URIs of every squiffy.json in the workspace
export const FIND_PROJECT_FILES = "squiffy/findProjectFiles";
export type FindProjectFilesResult = string[];

// Every file under a folder, as paths from it with "/" separators, leaving out the folders a
// story never uses (node_modules, .git and the like)
export const LIST_FILES = "squiffy/listFiles";
export interface ListFilesParams { root: string }
export type ListFilesResult = string[];

// A file's text. Fails if it can't be read.
export const READ_TEXT = "squiffy/readText";
export interface ReadTextParams { uri: string }
export type ReadTextResult = string;

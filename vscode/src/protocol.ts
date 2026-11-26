// The extension's own requests between the client (in the extension host) and the language
// server, besides LSP's. The server reads files through the client, with VS Code's workspace.fs,
// so it works the same on the desktop and the web, and with files that aren't on disk.

import type { PreviewStory, StoryGraph } from "squiffy-compiler/language-service";

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
export interface ExportStoryParams {
    uri: string;
    // For a single-file export: the story's assets, in base64, by their path from the main file's
    // folder, which go in the page. Without them, the files are the page and story.js, to go
    // beside the story's assets.
    inlineAssets?: Record<string, string>;
    // A file the client has just written (a squiffy.json given an ID, to publish it), which is
    // read again first, as the file watcher might not have said so yet
    changed?: string;
}
export type ExportStoryResult =
    | {
        success: true; files: Record<string, string>;
        // The main file's folder, which the published story's assets are in
        root: string;
        title?: string;
        // The story's own folder (squiffy.json's, if it has one), its main file's path there, its
        // squiffy.json, and the ID that's in it, for a link to the story and for publishing it
        storyRoot: string; mainFile: string; projectFile?: string; id?: string;
    }
    | { success: false; errors: string[] };

// A squiffy.json for a story that hasn't one, to publish it: its text, which leaves out the folder's
// files that aren't part of the story, and the story's .squiffy files with their setters converted
// to Squiffy 7's rules, which a squiffy.json turns on. The client writes them.
export const NEW_PROJECT_FILE = "squiffy/newProjectFile";
export interface NewProjectFileParams { uri: string }
export type NewProjectFileResult =
    | {
        success: true; uri: string; text: string;
        // The files it leaves out, as paths from the story's folder
        exclude: string[];
        // The new text of each .squiffy file with setters that changed, by URI
        changes: Record<string, string>;
        // How many setters were converted, and where the ones that couldn't be are
        converted: number; problems: string[];
    }
    | { success: false; errors: string[] };

// The section (and passage) at a position, to start the preview there
export const SECTION_AT = "squiffy/sectionAt";
export interface SectionAtParams { uri: string; position: { line: number; character: number } }
export type SectionAtResult = { section: string; passage?: string } | null;

// The story map's graph for the story a file is part of. Its locations' files are paths from
// `root`, the story's folder.
export const STORY_GRAPH = "squiffy/storyGraph";
export interface StoryGraphParams { uri: string }
export interface StoryGraphResult {
    graph: StoryGraph;
    root: string;
    // The story's squiffy.json, if it has one, which is where positions chosen on the map are
    // kept. The client reads them, as the file may have changes that aren't saved.
    projectFile?: string;
    // The story's main file, as a path from `root`, where "Start the story here" sets @start
    mainFile: string;
}

// Makes a file the main file of the story in its folder, when there's no squiffy.json
export const SET_MAIN_FILE = "squiffy/setMainFile";
export interface SetMainFileParams { uri: string }

// The arguments of the commands the code lenses above each section run, in the client
// squiffy.previewFromHere: the file, and the section (and passage) to start at
export type PreviewFromHereArgs = [uri: string, startAt: { section: string; passage?: string }];
// squiffy.showLinksHere: the file and position to show the links beside, and the links
export type ShowLinksHereArgs = [uri: string, position: { line: number; character: number }, locations: { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }[]];

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

// Bytes as base64, to send in a request, which is JSON
export function toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

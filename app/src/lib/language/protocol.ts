// What the app and the language service worker call on each other (see rpc.ts).
import type { LanguageService, Location } from "squiffy-compiler/language-service";
import type { V5ConversionResult } from "squiffy-compiler";
import type { FileProblems } from "../problems.js";

// The language service's queries, as the worker exposes them
export type ServiceQueries = Omit<LanguageService, "updateFile" | "fileChanged" | "setMainFile" | "getAnalysis">;

// A story compiled for the preview (squiffy-runtime's PreviewStory), or why it can't be
export type CompiledStory =
    | { success: true; js: string; css: string[]; scripts: string[] }
    | { success: false; errors: string[] };

export type ExportKind = "zip" | "html" | "js";

// A published story: the packager's files (and zip), or why it can't be made
export type ExportResult =
    | { success: true; files: Record<string, string>; zip?: Uint8Array }
    | { success: false; errors: string[] };

export interface WorkerApi extends ServiceQueries {
    // Packages the story for publishing, with its assets (by their path from the main file's
    // folder): a zip of HTML, JavaScript and assets; one HTML file; or the story's JavaScript
    exportStory(kind: ExportKind, assets: Record<string, Uint8Array>): Promise<ExportResult>;
    // Compiles the story from the language service's latest analysis, for the preview
    compile(): Promise<CompiledStory>;
    // Squiffy 5 text processor syntax in a file: how much there is, and the file converted to
    // Squiffy 6's, as the 6.x editor offers when it opens one
    countV5Syntax(text: string): number;
    convertV5Syntax(text: string): V5ConversionResult;
    // The .squiffy files that make up the story as it is now: the main file, what it @imports and,
    // with a squiffy.json, the rest of the folder's. Complete only if the story has no errors, as
    // the analysis stops at the first.
    getStoryFiles(): Promise<{ files: string[]; complete: boolean }>;
    // Every problem in the story, in each file that has any, with the code actions that fix them:
    // for the Problems panel
    getProblems(): Promise<FileProblems[]>;
    // Where a section, or a passage in it, is defined: for following the preview
    findSection(section: string, passage?: string): Promise<Location | undefined>;
    // Starts (or restarts) the service for a project
    open(mainFile: string): void;
    updateFile(path: string, text: string | undefined): void;
    fileChanged(path: string): void;
    setMainFile(path: string): void;
}

// Read access to the open project, which the worker calls back to the app for
export interface HostApi {
    list(): Promise<{ path: string }[]>;
    readText(path: string): Promise<string>;
}


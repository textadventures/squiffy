// What the app and the language service worker call on each other (see rpc.ts).
import type { LanguageService } from "squiffy-compiler/language-service";

// The language service's queries, as the worker exposes them
export type ServiceQueries = Omit<LanguageService, "updateFile" | "fileChanged" | "setMainFile" | "getAnalysis">;

export interface WorkerApi extends ServiceQueries {
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


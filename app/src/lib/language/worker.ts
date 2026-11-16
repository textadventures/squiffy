// The language service, in a Web Worker so analysing a large story never blocks typing. It reads
// project files by calling back to the app (HostApi), and the app sends it the text of the file
// being edited with updateFile() as it changes.
import { emit, formatDiagnostic } from "squiffy-compiler";
import { createLanguageService, type LanguageService } from "squiffy-compiler/language-service";
import { dirname, resolvePath } from "@textadventures/project-fs";
import { connect, type Handlers, type Port } from "../rpc.js";
import type { CompiledStory, HostApi, WorkerApi } from "./protocol.js";

let service: LanguageService | undefined;
let mainFile = "";

// The story's own stylesheets and scripts (@import of .css and .js files), which are named
// relative to the main file. One that can't be read is left out, as the compiler does.
async function readAll(names: string[]): Promise<string[]> {
    const texts = await Promise.all(names.map(async name => {
        const path = resolvePath(dirname(mainFile), name);
        if (path === null) return undefined;
        try {
            return await host.call("readText", path);
        } catch {
            return undefined;
        }
    }));
    return texts.filter((t): t is string => t !== undefined);
}

// Emits the analysis the language service already has, so the story isn't parsed again
async function compile(): Promise<CompiledStory> {
    const analysis = await current().getAnalysis();
    if (!analysis.success) {
        return {
            success: false,
            errors: analysis.diagnostics.filter(d => d.severity === "error").map(formatDiagnostic),
        };
    }
    const result = emit(analysis);
    const info = result.getUiInfo();
    const [css, scripts] = await Promise.all([readAll(info.externalStylesheets), readAll(info.externalScripts)]);
    return { success: true, js: await result.getJs(true), css, scripts };
}

function current(): LanguageService {
    if (!service) throw new Error("No project is open");
    return service;
}

const handlers: WorkerApi = {
    open(path) {
        mainFile = path;
        service = createLanguageService({
            mainFile,
            files: {
                list: () => host.call("list"),
                readText: path => host.call("readText", path),
            },
        });
    },
    updateFile: (path, text) => current().updateFile(path, text),
    fileChanged: path => current().fileChanged(path),
    setMainFile: path => {
        mainFile = path;
        current().setMainFile(path);
    },
    compile,
    getDiagnostics: path => current().getDiagnostics(path),
    getDocumentSymbols: path => current().getDocumentSymbols(path),
    getDefinition: (path, position) => current().getDefinition(path, position),
    getReferences: (path, position, includeDeclaration) => current().getReferences(path, position, includeDeclaration),
    getRenameEdits: (path, position, newName) => current().getRenameEdits(path, position, newName),
    getCompletions: (path, position) => current().getCompletions(path, position),
    getHover: (path, position) => current().getHover(path, position),
    getFoldingRanges: path => current().getFoldingRanges(path),
    getCodeActions: (path, range) => current().getCodeActions(path, range),
    getSectionAt: (path, position) => current().getSectionAt(path, position),
};

const host = connect<HostApi & Handlers>(self as unknown as Port, handlers as unknown as Handlers);

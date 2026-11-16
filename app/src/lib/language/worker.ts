// The language service, in a Web Worker so analysing a large story never blocks typing. It reads
// project files by calling back to the app (HostApi), and the app sends it the text of the file
// being edited with updateFile() as it changes.
import { createLanguageService, type LanguageService } from "squiffy-compiler/language-service";
import { connect, type Handlers, type Port } from "../rpc.js";
import type { HostApi, WorkerApi } from "./protocol.js";

let service: LanguageService | undefined;

function current(): LanguageService {
    if (!service) throw new Error("No project is open");
    return service;
}

const handlers: WorkerApi = {
    open(mainFile) {
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
    setMainFile: path => current().setMainFile(path),
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

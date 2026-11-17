// The language service, in a Web Worker so analysing a large story never blocks typing. It reads
// project files by calling back to the app (HostApi), and the app sends it the text of the file
// being edited with updateFile() as it changes.
import { convertV5Syntax, emit, findV5Syntax, formatDiagnostic } from "squiffy-compiler";
import { createLanguageService, type LanguageService } from "squiffy-compiler/language-service";
import { dirname, resolvePath } from "@textadventures/project-fs";
import { connect, type Handlers, type Port } from "../rpc.js";
import type { CompiledStory, ExportKind, ExportResult, HostApi, WorkerApi } from "./protocol.js";

let service: LanguageService | undefined;

// The packager carries the whole runtime, so it's only loaded when the story's exported
async function exportStory(kind: ExportKind, assets: Record<string, Uint8Array>): Promise<ExportResult> {
    const analysis = await current().getAnalysis();
    const errors = errorsIn(analysis);
    if (errors) return { success: false, errors };
    // A published story declares a global, which the packager's page loads with a <script>
    const result = emit(analysis, { globalJs: true });
    if (kind === "js") return { success: true, files: { "story.js": await result.getJs() } };
    const { createPackage } = await import("@textadventures/squiffy-packager");
    const pkg = await createPackage(result, { createZip: kind === "zip", inlineHtml: kind === "html", assets });
    return { success: true, files: pkg.files, zip: pkg.zip };
}

// The story's own stylesheets and scripts (@import of .css and .js files), which are named
// relative to the main file. One that can't be read is left out, as the compiler does.
async function readAll(names: string[]): Promise<string[]> {
    // squiffy.json's main file, if the project has one
    const main = (await current().getProjectInfo()).mainFile;
    const texts = await Promise.all(names.map(async name => {
        const path = resolvePath(dirname(main), name);
        if (path === null) return undefined;
        try {
            return await host.call("readText", path);
        } catch {
            return undefined;
        }
    }));
    return texts.filter((t): t is string => t !== undefined);
}

// The story's errors, if the analysis has any
function errorsIn(analysis: Awaited<ReturnType<LanguageService["getAnalysis"]>>): string[] | null {
    if (analysis.success) return null;
    return analysis.diagnostics.filter(d => d.severity === "error").map(formatDiagnostic);
}

// Emits the analysis the language service already has, so the story isn't parsed again
async function compile(): Promise<CompiledStory> {
    const analysis = await current().getAnalysis();
    const errors = errorsIn(analysis);
    if (errors) return { success: false, errors };
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
        service = createLanguageService({
            mainFile: path,
            files: {
                list: () => host.call("list"),
                readText: path => host.call("readText", path),
            },
        });
    },
    updateFile: (path, text) => current().updateFile(path, text),
    fileChanged: path => current().fileChanged(path),
    setMainFile: path => current().setMainFile(path),
    getProjectInfo: () => current().getProjectInfo(),
    compile,
    exportStory,
    countV5Syntax: text => findV5Syntax(text).length,
    convertV5Syntax: text => convertV5Syntax(text),
    async findSection(section, passage) {
        const symbol = (await current().getAnalysis()).sections.find(s => s.name === section);
        const node = passage ? symbol?.passages.find(p => p.name === passage)?.node : symbol?.node;
        if (!symbol || !node) return undefined;
        return { file: symbol.file, range: ("nameRange" in node && node.nameRange) || node.range };
    },
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
    getStoryGraph: () => current().getStoryGraph(),
};

const host = connect<HostApi & Handlers>(self as unknown as Port, handlers as unknown as Handlers);

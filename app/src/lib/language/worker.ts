// The language service, in a Web Worker so analysing a large story never blocks typing. It reads
// project files by calling back to the app (HostApi), and the app sends it the text of the file
// being edited with updateFile() as it changes.
import { convertV5Syntax, emit, findV5Syntax, formatDiagnostic, resolveCssUrl, rewriteCssUrls } from "squiffy-compiler";
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
    const { projectFile } = await current().getProjectInfo();
    // A published story declares a global, which the packager's page loads with a <script>
    const result = emit(analysis, { globalJs: true, projectId: projectFile?.id, panels: projectFile?.panels, settings: projectFile?.settings, persistent: projectFile?.persistent });
    if (kind === "js") return { success: true, files: { "story.js": await result.getJs() } };
    const { createPackage } = await import("@textadventures/squiffy-packager");
    const pkg = await createPackage(result, {
        createZip: kind === "zip", inlineHtml: kind === "html", assets, backButton: projectFile?.backButton,
        saveButton: projectFile?.saveButton, strings: projectFile?.strings,
    });
    return { success: true, files: pkg.files, zip: pkg.zip };
}

// The story's own stylesheets and scripts (@import of .css and .js files), which are named
// relative to the main file. One that can't be read is left out, as the compiler does.
async function readAll(names: string[], stylesheets = false): Promise<string[]> {
    // squiffy.json's main file, if the project has one
    const main = (await current().getProjectInfo()).mainFile;
    const texts = await Promise.all(names.map(async name => {
        const path = resolvePath(dirname(main), name);
        if (path === null) return undefined;
        try {
            const text = await host.call("readText", path);
            // The preview finds a stylesheet's fonts and images by their path from the story's folder
            return stylesheets ? rewriteCssUrls(text, url => resolveCssUrl(name, url) ?? undefined) : text;
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
    // With the panels and settings, which the preview shows as the published page would
    const { projectFile } = await current().getProjectInfo();
    const result = emit(analysis, { panels: projectFile?.panels, settings: projectFile?.settings, persistent: projectFile?.persistent });
    const info = result.getUiInfo();
    const [css, scripts] = await Promise.all([readAll(info.externalStylesheets, true), readAll(info.externalScripts)]);
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
    async getStoryFiles() {
        const analysis = await current().getAnalysis();
        return {
            files: analysis.files.map(f => f.filename).filter((f): f is string => f !== undefined),
            pageFiles: [...analysis.stylesheets, ...analysis.scripts],
            complete: analysis.success,
        };
    },
    async getProblems() {
        const service = current();
        const analysis = await service.getAnalysis();
        // The story's files, and any other file the analysis found a problem in. The story graph's
        // problems (dead ends and so on) are only ever in the story's files.
        const files = new Set([
            ...analysis.files.map(f => f.filename),
            ...analysis.diagnostics.map(d => d.file),
        ].filter((f): f is string => !!f));
        const everything = { start: { line: 0, character: 0 }, end: { line: Number.MAX_SAFE_INTEGER, character: 0 } };
        const results = await Promise.all([...files].map(async file => {
            const diagnostics = await service.getDiagnostics(file);
            if (!diagnostics.length) return null;
            return { file, diagnostics, actions: await service.getCodeActions(file, everything) };
        }));
        return results.filter(r => r !== null);
    },
    async findSection(section, passage) {
        const symbol = (await current().getAnalysis()).sections.find(s => s.name === section);
        const node = passage ? symbol?.passages.find(p => p.name === passage)?.node : symbol?.node;
        if (!symbol || !node) return undefined;
        return { file: symbol.file, range: ("nameRange" in node && node.nameRange) || node.range };
    },
    getDiagnostics: path => current().getDiagnostics(path),
    getAllDiagnostics: () => current().getAllDiagnostics(),
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

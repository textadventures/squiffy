// The Squiffy language server: the language service (squiffy-compiler/language-service) over LSP.
// The same code runs in a Node process on the desktop and in a Web Worker on the web; node.ts and
// web.ts make the connection.

import {
    type CodeLens, CodeLensRefreshRequest, type Connection, DidChangeWatchedFilesNotification, FileChangeType, ResponseError, TextDocuments, TextDocumentSyncKind,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { emit, formatDiagnostic } from "squiffy-compiler";
import { createPackage } from "@textadventures/squiffy-packager";
import {
    EXPORT_STORY, FIND_PROJECT_FILES, fromBase64, LIST_FILES, PREVIEW_STORY, READ_TEXT, SECTION_AT, SET_MAIN_FILE,
    type ExportStoryParams, type ExportStoryResult, type FindProjectFilesResult, type ListFilesParams, type ListFilesResult, type PreviewStoryParams, type PreviewStoryResult,
    type PreviewFromHereArgs, type ReadTextParams, type ReadTextResult, type SectionAtParams, type SectionAtResult, type SetMainFileParams,
    type ShowLinksHereArgs,
} from "../protocol.js";
import { groupDiagnostics, markdown, toLspCodeAction, toLspCompletion, toLspSymbol, toLspWorkspaceEdit } from "./convert.js";
import { folderOf, Stories, type Story, toPath, toUri } from "./stories.js";

// How long to wait after a change before checking the story again
const DIAGNOSTICS_DELAY = 250;

export function startServer(connection: Connection) {
    const documents = new TextDocuments(TextDocument);
    const stories = new Stories({
        findProjectFiles: () => connection.sendRequest<FindProjectFilesResult>(FIND_PROJECT_FILES),
        listFiles: root => connection.sendRequest<ListFilesResult>(LIST_FILES, { root } satisfies ListFilesParams),
        readText: uri => connection.sendRequest<ReadTextResult>(READ_TEXT, { uri } satisfies ReadTextParams),
    });

    // The story a file is part of, and its path there
    async function locate(uri: string): Promise<{ story: Story; path: string }> {
        const story = await stories.storyFor(uri);
        return { story, path: toPath(story.root, uri)! };
    }

    // ---- Diagnostics ----

    // The files each story has published diagnostics for, so they can be cleared
    const published = new Map<string, Set<string>>();
    const pending = new Map<string, ReturnType<typeof setTimeout>>();

    function scheduleDiagnostics(story: Story) {
        clearTimeout(pending.get(story.root));
        pending.set(story.root, setTimeout(() => {
            pending.delete(story.root);
            void publishDiagnostics(story);
        }, DIAGNOSTICS_DELAY));
    }

    // Diagnostics are published for every file in the story at once, as a change to one file can
    // cause or fix problems in another (a link to a section that's renamed, say).
    async function publishDiagnostics(story: Story) {
        let byUri: ReturnType<typeof groupDiagnostics>;
        try {
            byUri = groupDiagnostics(story.root, await story.service.getAllDiagnostics());
        }
        catch (e) {
            connection.console.error(`Couldn't check the story in ${story.root}: ${e}`);
            return;
        }
        const before = published.get(story.root) ?? new Set();
        for (const uri of before) {
            if (!byUri.has(uri)) void connection.sendDiagnostics({ uri, diagnostics: [] });
        }
        for (const [uri, diagnostics] of byUri) void connection.sendDiagnostics({ uri, diagnostics });
        published.set(story.root, new Set(byUri.keys()));
        // A link added in one file changes the counts above sections in another
        if (codeLensRefresh) void connection.sendRequest(CodeLensRefreshRequest.type);
    }

    // After a squiffy.json comes or goes, the stories start again
    function clearAllDiagnostics() {
        for (const uris of published.values()) {
            for (const uri of uris) void connection.sendDiagnostics({ uri, diagnostics: [] });
        }
        published.clear();
    }

    // ---- Lifecycle ----

    // Whether the client can be told to ask for the code lenses again, after another file changes
    let codeLensRefresh = false;

    connection.onInitialize(({ capabilities: client }) => {
        codeLensRefresh = !!client.workspace?.codeLens?.refreshSupport;
        return {
            capabilities: {
                textDocumentSync: TextDocumentSyncKind.Incremental,
                documentSymbolProvider: true,
                definitionProvider: true,
                referencesProvider: true,
                renameProvider: { prepareProvider: true },
                completionProvider: { triggerCharacters: ["[", "{", "@", "\""] },
                hoverProvider: true,
                foldingRangeProvider: true,
                codeActionProvider: { codeActionKinds: ["quickfix"] },
                codeLensProvider: {},
            },
        };
    });

    connection.onInitialized(() => {
        // The client watches the story files, so the stories hear about changes made outside the
        // editor, and files added and deleted
        void connection.client.register(DidChangeWatchedFilesNotification.type, {
            watchers: [{ globPattern: "**/*.{squiffy,css,js}" }, { globPattern: "**/squiffy.json" }],
        });
    });

    documents.onDidOpen(async ({ document }) => {
        scheduleDiagnostics(await stories.setOpenText(document.uri, document.getText()));
    });
    documents.onDidChangeContent(async ({ document }) => {
        scheduleDiagnostics(await stories.setOpenText(document.uri, document.getText()));
    });
    documents.onDidClose(async ({ document }) => {
        scheduleDiagnostics(await stories.setOpenText(document.uri, undefined));
    });

    connection.onDidChangeWatchedFiles(async ({ changes }) => {
        const affected = new Set<Story>();
        for (const change of changes) {
            // An open file's text comes from its editor, until it's deleted
            if (documents.get(change.uri) && change.type != FileChangeType.Deleted) continue;
            const result = await stories.fileChanged(change.uri);
            if (result == "reset") {
                // Which story each file is part of has changed
                clearAllDiagnostics();
                affected.clear();
                for (const document of documents.all()) {
                    affected.add(await stories.setOpenText(document.uri, document.getText()));
                }
            }
            else {
                for (const story of result) affected.add(story);
            }
        }
        for (const story of affected) scheduleDiagnostics(story);
    });

    // ---- Language features ----

    connection.onDocumentSymbol(async ({ textDocument }) => {
        const { story, path } = await locate(textDocument.uri);
        return (await story.service.getDocumentSymbols(path)).map(toLspSymbol);
    });

    connection.onDefinition(async ({ textDocument, position }) => {
        const { story, path } = await locate(textDocument.uri);
        const location = await story.service.getDefinition(path, position);
        return location && { uri: toUri(story.root, location.file), range: location.range };
    });

    connection.onReferences(async ({ textDocument, position, context }) => {
        const { story, path } = await locate(textDocument.uri);
        const locations = await story.service.getReferences(path, position, context.includeDeclaration);
        return locations.map(location => ({ uri: toUri(story.root, location.file), range: location.range }));
    });

    // The name to rename: a section or passage's name in its header, or in a link's target
    connection.onPrepareRename(async ({ textDocument, position }) => {
        const { story, path } = await locate(textDocument.uri);
        const target = await story.service.getRenameTarget(path, position);
        if (!target) throw new ResponseError(0, "Only sections and passages can be renamed");
        return { range: target.range, placeholder: target.name };
    });

    connection.onRenameRequest(async ({ textDocument, position, newName }) => {
        const { story, path } = await locate(textDocument.uri);
        const result = await story.service.getRenameEdits(path, position, newName);
        if (!result) return null;
        if ("error" in result) throw new ResponseError(0, result.error);
        return toLspWorkspaceEdit(story.root, result.edit);
    });

    connection.onCompletion(async ({ textDocument, position }) => {
        const { story, path } = await locate(textDocument.uri);
        return (await story.service.getCompletions(path, position)).map(toLspCompletion);
    });

    connection.onHover(async ({ textDocument, position }) => {
        const { story, path } = await locate(textDocument.uri);
        const hover = await story.service.getHover(path, position);
        return hover && { contents: markdown(hover.contents), range: hover.range };
    });

    connection.onFoldingRanges(async ({ textDocument }) => {
        const { story, path } = await locate(textDocument.uri);
        return story.service.getFoldingRanges(path);
    });

    connection.onCodeAction(async ({ textDocument, range }) => {
        const { story, path } = await locate(textDocument.uri);
        return (await story.service.getCodeActions(path, range)).map(action => toLspCodeAction(story.root, action));
    });

    // Above each section and passage's header: a link to start the preview there, and how many
    // links lead to it, which lists them
    connection.onCodeLens(async ({ textDocument }) => {
        const { story, path } = await locate(textDocument.uri);
        const graph = await story.service.getStoryGraph();
        const lenses: CodeLens[] = [];
        for (const node of graph.nodes) {
            // Not the master section, which is part of every section, or its passages, which
            // panels show
            if (node.location.file != path || node.name == "" || node.section == "") continue;
            const range = node.location.range;
            const startAt: PreviewFromHereArgs[1] = node.kind == "passage"
                ? { section: node.section!, passage: node.name }
                : { section: node.name };
            lenses.push({
                range,
                command: {
                    title: "$(play) Preview from here",
                    command: "squiffy.previewFromHere",
                    arguments: [textDocument.uri, startAt] satisfies PreviewFromHereArgs,
                },
            });
            // A section without a name of its own (the text before the first section, or after a
            // +++ or ---) has no name to link to
            if (node.kind == "section" && node.detail) continue;
            const references = await story.service.getReferences(path, range.start, false);
            const count = references.length;
            lenses.push({
                range,
                command: count
                    ? {
                        title: count == 1 ? "1 link here" : `${count} links here`,
                        command: "squiffy.showLinksHere",
                        arguments: [textDocument.uri, range.start, references.map(r => ({ uri: toUri(story.root, r.file), range: r.range }))] satisfies ShowLinksHereArgs,
                    }
                    // A lens without a command is just text
                    : { title: "No links here", command: "" },
            });
        }
        return lenses;
    });

    // ---- Squiffy's own requests ----

    connection.onRequest(PREVIEW_STORY, async ({ uri }: PreviewStoryParams): Promise<PreviewStoryResult> => {
        const story = await stories.storyFor(uri);
        const [compiled, info] = await Promise.all([story.service.getPreviewStory(), story.service.getProjectInfo()]);
        return { ...compiled, root: folderOf(toUri(story.root, info.mainFile)) };
    });

    // As the editor exports it (app/src/lib/language/worker.ts), and the CLI builds it: without
    // its @test sections, unless squiffy.json's startAnywhere keeps them for testers
    connection.onRequest(EXPORT_STORY, async ({ uri, inlineAssets }: ExportStoryParams): Promise<ExportStoryResult> => {
        const story = await stories.storyFor(uri);
        const [analysis, { projectFile, mainFile }] = await Promise.all([story.service.getAnalysis(), story.service.getProjectInfo()]);
        if (!analysis.success) {
            return { success: false, errors: analysis.diagnostics.filter(d => d.severity == "error").map(formatDiagnostic) };
        }
        const result = emit(analysis, {
            globalJs: true, omitTestSections: !projectFile?.startAnywhere, projectId: projectFile?.id,
            panels: projectFile?.panels, settings: projectFile?.settings, persistent: projectFile?.persistent, headerTitle: projectFile?.headerTitle,
        });
        const root = folderOf(toUri(story.root, mainFile));
        // The cover is left out if it isn't there. A single-file export leaves it out anyway.
        const cover = projectFile?.cover;
        const hasCover = !inlineAssets && cover !== undefined
            && (await connection.sendRequest<ListFilesResult>(LIST_FILES, { root } satisfies ListFilesParams)).includes(cover);
        const pkg = await createPackage(result, {
            inlineHtml: !!inlineAssets,
            assets: inlineAssets && Object.fromEntries(Object.entries(inlineAssets).map(([path, text]) => [path, fromBase64(text)])),
            backButton: projectFile?.backButton, saveButton: projectFile?.saveButton,
            startAnywhere: projectFile?.startAnywhere, strings: projectFile?.strings,
            // What the story is, for the page's <head>
            id: projectFile?.id, description: projectFile?.description, author: projectFile?.author, language: projectFile?.language,
            cover: hasCover ? cover : undefined,
        });
        return { success: true, files: pkg.files, root, title: result.getUiInfo().title || undefined };
    });

    connection.onRequest(SECTION_AT, async ({ uri, position }: SectionAtParams): Promise<SectionAtResult> => {
        const { story, path } = await locate(uri);
        return (await story.service.getSectionAt(path, position)) ?? null;
    });

    connection.onRequest(SET_MAIN_FILE, async ({ uri }: SetMainFileParams) => {
        const story = await stories.setMainFile(uri);
        if (!story) throw new ResponseError(0, "This story's main file is set by its squiffy.json");
        scheduleDiagnostics(story);
    });

    documents.listen(connection);
    connection.listen();
}

// The extension: starts the language server, answers its requests for files, and adds the
// preview, the story map and commands. node.ts and web.ts start the server in a process or a Web Worker.

import * as vscode from "vscode";
import type { BaseLanguageClient, LanguageClientOptions } from "vscode-languageclient";
import { convertV5Syntax, findV5Syntax } from "squiffy-compiler";
import {
    FIND_PROJECT_FILES, LIST_FILES, READ_TEXT, SECTION_AT, SET_MAIN_FILE,
    type ListFilesParams, type PreviewFromHereArgs, type ShowLinksHereArgs, type ReadTextParams, type SectionAtParams, type SectionAtResult, type SetMainFileParams,
} from "../protocol.js";
import { findProjectFiles, isProjectFile, listFiles, readText } from "./files.js";
import { exportStory } from "./export.js";
import { convertQuestGamebook, convertTwineStory } from "./convert.js";
import { insertHeader, newStory } from "./new-story.js";
import { Preview } from "./preview.js";
import { StoryMap } from "./map.js";
import { SectionsView } from "./sections-view.js";
import { startAt, type NodeItem } from "./sections.js";

export type CreateClient = (options: LanguageClientOptions) => BaseLanguageClient;

let client: BaseLanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext, createClient: CreateClient) {
    client = createClient({
        documentSelector: [{ language: "squiffy" }],
    });
    client.onRequest(FIND_PROJECT_FILES, () => findProjectFiles());
    client.onRequest(LIST_FILES, ({ root }: ListFilesParams) => listFiles(vscode.Uri.parse(root)));
    client.onRequest(READ_TEXT, ({ uri }: ReadTextParams) => readText(vscode.Uri.parse(uri)));
    await client.start();

    const log = vscode.window.createOutputChannel("Squiffy Preview");
    const preview = new Preview(client, log);
    const map = new StoryMap(client, context.extensionUri, preview);
    const sections = new SectionsView(client);
    context.subscriptions.push(log, preview, map, sections);

    // The active editor, if it's a .squiffy file, for the commands that act at the cursor
    const activeSquiffyEditor = () => {
        const editor = vscode.window.activeTextEditor;
        return editor?.document.languageId == "squiffy" ? editor : undefined;
    };
    // The active editor's file, if it's part of a story: a .squiffy file, or a squiffy.json, as
    // its title, panels and settings are the story's too. For the commands that act on the story.
    const activeStoryUri = () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return undefined;
        const uri = editor.document.uri;
        return editor.document.languageId == "squiffy" || isProjectFile(uri) ? uri : undefined;
    };
    // The story to act on: the active editor's, or the one the Sections view shows, for its buttons
    const storyUri = () => activeStoryUri() ?? sections.storyUri;

    const command = (id: string, run: (...args: unknown[]) => unknown) =>
        context.subscriptions.push(vscode.commands.registerCommand(id, run));

    command("squiffy.showPreview", (uri?: unknown) => {
        const target = uri instanceof vscode.Uri ? uri : storyUri();
        if (target) return preview.show(target);
    });

    command("squiffy.showMap", (uri?: unknown) => {
        const target = uri instanceof vscode.Uri ? uri : storyUri();
        if (target) return map.show(target);
    });

    // Control or Command and F while the map has the focus, in place of the script's Find
    command("squiffy.searchMap", () => map.search());

    command("squiffy.previewFromHere", async (...args: unknown[]) => {
        // From a code lens above a section, which says where to start
        if (typeof args[0] == "string") {
            const [uri, startAt] = args as PreviewFromHereArgs;
            return preview.show(vscode.Uri.parse(uri), startAt);
        }
        const editor = activeSquiffyEditor();
        if (!editor) return;
        const at = await client!.sendRequest<SectionAtResult>(SECTION_AT, {
            uri: editor.document.uri.toString(),
            // As a plain object: on the web, the server is in a worker, and a vscode.Position
            // would arrive there with only its private fields
            position: { line: editor.selection.active.line, character: editor.selection.active.character },
        } satisfies SectionAtParams);
        return preview.show(editor.document.uri, at ?? undefined);
    });

    // From the code lens above a section that counts the links to it: lists them in a peek
    command("squiffy.showLinksHere", (...args: unknown[]) => {
        const [uri, position, locations] = args as ShowLinksHereArgs;
        const toPosition = (p: { line: number; character: number }) => new vscode.Position(p.line, p.character);
        return vscode.commands.executeCommand("editor.action.showReferences",
            vscode.Uri.parse(uri), toPosition(position),
            locations.map(l => new vscode.Location(vscode.Uri.parse(l.uri), new vscode.Range(toPosition(l.range.start), toPosition(l.range.end)))));
    });

    // The inline button on a section or passage in the Sections view
    command("squiffy.previewSection", (item?: unknown) => {
        if (!item) return;
        const at = startAt(item as NodeItem);
        if (at) return preview.show(sections.fileOf(item as NodeItem), at);
    });

    command("squiffy.restartPreview", () => preview.restart());
    command("squiffy.previewBack", () => preview.back());

    command("squiffy.setMainFile", async () => {
        const editor = activeSquiffyEditor();
        if (!editor) return;
        try {
            await client!.sendRequest(SET_MAIN_FILE, { uri: editor.document.uri.toString() } satisfies SetMainFileParams);
        }
        catch (e) {
            void vscode.window.showInformationMessage(e instanceof Error ? e.message : String(e));
        }
    });

    command("squiffy.export", (uri?: unknown) => {
        const target = uri instanceof vscode.Uri ? uri : storyUri();
        if (target) return exportStory(client!, target);
        void vscode.window.showInformationMessage("Open a .squiffy file or squiffy.json to export its story.");
    });

    command("squiffy.newStory", () => newStory());
    // From the Explorer's context menu, in that folder
    command("squiffy.newStoryInFolder", (uri?: unknown) => newStory(uri instanceof vscode.Uri ? uri : undefined));
    command("squiffy.convertTwine", () => convertTwineStory());
    command("squiffy.convertQuest", () => convertQuestGamebook());

    command("squiffy.addSection", async () => {
        let editor = activeSquiffyEditor();
        // From the Sections view, with no .squiffy file in front: at the end of the story's main file
        if (!editor) {
            const main = sections.mainFileUri();
            if (!main) return;
            editor = await vscode.window.showTextDocument(main);
            const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
            editor.selection = new vscode.Selection(end, end);
        }
        return insertHeader(editor, "section");
    });
    command("squiffy.addPassage", () => {
        const editor = activeSquiffyEditor();
        if (editor) return insertHeader(editor, "passage");
    });

    // A Preview button in the status bar, while a .squiffy file or squiffy.json is open
    const status = vscode.window.createStatusBarItem("squiffy.preview", vscode.StatusBarAlignment.Right, 100);
    status.name = "Squiffy Preview";
    status.text = "$(play) Preview";
    status.tooltip = "Play the story in the preview";
    status.command = "squiffy.showPreview";
    const updateStatus = () => activeStoryUri() ? status.show() : status.hide();
    updateStatus();
    context.subscriptions.push(status, vscode.window.onDidChangeActiveTextEditor(updateStatus));

    command("squiffy.convertV5", async () => {
        const editor = activeSquiffyEditor();
        if (!editor) return;
        const text = editor.document.getText();
        if (!findV5Syntax(text).length) {
            void vscode.window.showInformationMessage("This file has no Squiffy 5 syntax to convert.");
            return;
        }
        const result = convertV5Syntax(text);
        const whole = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(text.length));
        // One edit, so Undo puts it all back
        await editor.edit(edit => edit.replace(whole, result.script));
        const javascript = result.problems.filter(problem => problem.javascript);
        const others = result.problems.length - javascript.length;
        if (others) {
            void vscode.window.showWarningMessage(`Converted, but ${others} part(s) need checking by hand. They're in the Problems panel.`);
        }
        if (javascript.length) {
            void vscode.window.showWarningMessage(`The JavaScript on line ${javascript.map(problem => problem.line).join(", ")} uses jQuery, which Squiffy 7 doesn't load, so needs changing by hand.`);
        }
    });
}

export function deactivate() {
    return client?.stop();
}

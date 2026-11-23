// The extension: starts the language server, answers its requests for files, and adds the
// preview and commands. node.ts and web.ts start the server in a process or a Web Worker.

import * as vscode from "vscode";
import type { BaseLanguageClient, LanguageClientOptions } from "vscode-languageclient";
import { convertV5Syntax, findV5Syntax } from "squiffy-compiler";
import {
    FIND_PROJECT_FILES, LIST_FILES, READ_TEXT, SECTION_AT, SET_MAIN_FILE,
    type ListFilesParams, type ReadTextParams, type SectionAtParams, type SectionAtResult, type SetMainFileParams,
} from "../protocol.js";
import { findProjectFiles, listFiles, readText } from "./files.js";
import { Preview } from "./preview.js";

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
    context.subscriptions.push(log, preview);

    const activeSquiffyEditor = () => {
        const editor = vscode.window.activeTextEditor;
        return editor?.document.languageId == "squiffy" ? editor : undefined;
    };

    const command = (id: string, run: (...args: unknown[]) => unknown) =>
        context.subscriptions.push(vscode.commands.registerCommand(id, run));

    command("squiffy.showPreview", (uri?: unknown) => {
        const target = uri instanceof vscode.Uri ? uri : activeSquiffyEditor()?.document.uri;
        if (target) return preview.show(target);
    });

    command("squiffy.previewFromHere", async () => {
        const editor = activeSquiffyEditor();
        if (!editor) return;
        const at = await client!.sendRequest<SectionAtResult>(SECTION_AT, {
            uri: editor.document.uri.toString(),
            position: editor.selection.active,
        } satisfies SectionAtParams);
        return preview.show(editor.document.uri, at ?? undefined);
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
        if (result.problems.length) {
            void vscode.window.showWarningMessage(`Converted, but ${result.problems.length} part(s) need checking by hand. They're in the Problems panel.`);
        }
    });
}

export function deactivate() {
    return client?.stop();
}

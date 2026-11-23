// The extension on vscode.dev and github.dev, with the language server in a Web Worker
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { activate as activateExtension } from "./extension.js";

export { deactivate } from "./extension.js";

export function activate(context: vscode.ExtensionContext) {
    const worker = new Worker(vscode.Uri.joinPath(context.extensionUri, "dist", "web", "server.js").toString(true));
    return activateExtension(context, options => new LanguageClient("squiffy", "Squiffy", worker, options));
}

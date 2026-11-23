// The extension on the desktop, with the language server in its own Node process
import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import { activate as activateExtension } from "./extension.js";

export { deactivate } from "./extension.js";

export function activate(context: vscode.ExtensionContext) {
    const module = vscode.Uri.joinPath(context.extensionUri, "dist", "node", "server.js").fsPath;
    return activateExtension(context, options => new LanguageClient("squiffy", "Squiffy", {
        run: { module, transport: TransportKind.ipc },
        debug: { module, transport: TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect=6009"] } },
    }, options));
}

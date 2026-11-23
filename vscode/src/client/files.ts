// Reading the workspace for the language server, with workspace.fs, which works on the desktop and
// the web, and for files that aren't on disk (on github.dev, say).

import * as vscode from "vscode";

// Folders a story never uses
const isSkippedFolder = (name: string) => name == "node_modules" || name.startsWith(".");

// The most files to list in a folder. A .squiffy file opened on its own makes its folder a story,
// which could be a big folder, such as Downloads.
const MAX_FILES = 5000;

// The story's own files, which are never assets for the preview or an export: its .squiffy files,
// squiffy.json, playthrough tests and backups
export const isStoryFile = (path: string) => /\.(squiffy|squiffy-test)$/.test(path) || path == "squiffy.json" || path.endsWith(".bak");

export async function findProjectFiles(): Promise<string[]> {
    const uris = await vscode.workspace.findFiles("**/squiffy.json", "**/{node_modules,.*}/**");
    return uris.map(uri => uri.toString());
}

// Every file under a folder, as paths from it with "/" separators
export async function listFiles(root: vscode.Uri): Promise<string[]> {
    const files: string[] = [];
    const folders: string[] = [""];
    while (folders.length && files.length < MAX_FILES) {
        const folder = folders.shift()!;
        let entries: [string, vscode.FileType][];
        try {
            entries = await vscode.workspace.fs.readDirectory(folder ? vscode.Uri.joinPath(root, folder) : root);
        }
        catch {
            continue;
        }
        for (const [name, type] of entries) {
            const path = folder ? `${folder}/${name}` : name;
            if (type & vscode.FileType.Directory) {
                if (!isSkippedFolder(name)) folders.push(path);
            }
            else if (type & vscode.FileType.File) {
                files.push(path);
            }
        }
    }
    return files;
}

export async function readText(uri: vscode.Uri): Promise<string> {
    // An open file's text, saved or not
    const open = vscode.workspace.textDocuments.find(doc => doc.uri.toString() == uri.toString());
    if (open) return open.getText();
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

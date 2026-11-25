// Squiffy: Export: the story built to be published, as the editor and the CLI build it: into a
// folder or a zip (index.html, story.js, the page's stylesheets and the story's assets), as one
// HTML file with everything in it, or only its story.js, for a page of the author's own. Files are
// written with workspace.fs, so it works on the web too.

import * as vscode from "vscode";
import type { BaseLanguageClient } from "vscode-languageclient";
import { strToU8, zipSync } from "fflate";
import { BUILD_FOLDER } from "squiffy-compiler";
import { EXPORT_STORY, type ExportStoryParams, type ExportStoryResult, toBase64 } from "../protocol.js";
import { isStoryFile, listFiles } from "./files.js";

// A file name from a story's title, e.g. "The Cave" -> "The Cave.zip", as the editor names it
// (app/src/lib/export.ts)
export function fileName(title: string | undefined, extension: string) {
    const name = [...(title ?? "")].filter(c => c >= " " && !'\\/:*?"<>|'.includes(c)).join("").trim() || "story";
    return `${name}${extension}`;
}

// Whether a URI is the folder, or in it
const isIn = (uri: vscode.Uri, folder: vscode.Uri) => {
    const path = folder.toString().replace(/\/$/, "");
    return uri.toString() == path || uri.toString().startsWith(path + "/");
};

const sameFolder = (a: vscode.Uri, b: vscode.Uri) => a.toString().replace(/\/$/, "") == b.toString().replace(/\/$/, "");

// A file or folder's name for a message: its path in the workspace
const describe = (uri: vscode.Uri) => {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder && sameFolder(folder.uri, uri)) return folder.name;
    return vscode.workspace.asRelativePath(uri);
};

// The files an export would replace, by name: "story.js", "story.js and style.css", or the first
// few of a longer list
export function clashMessage(names: string[]): string {
    const sorted = [...names].sort();
    if (sorted.length == 1) return sorted[0];
    if (sorted.length <= 4) return `${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
    return `${sorted.slice(0, 3).join(", ")} and ${sorted.length - 3} other files`;
}

const exists = async (uri: vscode.Uri) => {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    }
    catch {
        return false;
    }
};

// What the published story needs besides its own code: every file other than the story's own
// (.squiffy files, squiffy.json, tests and backups) in the main file's folder, by its path from
// there. Where the story's being exported to is left out when that's in the story's folder (a
// build folder, or the zip), so an earlier export isn't copied in.
async function storyAssets(root: vscode.Uri, target: vscode.Uri): Promise<Record<string, Uint8Array>> {
    const skip = isIn(target, root) && !sameFolder(target, root) ? target : undefined;
    const assets: Record<string, Uint8Array> = {};
    for (const path of await listFiles(root)) {
        const uri = vscode.Uri.joinPath(root, path);
        if (isStoryFile(path) || (skip && isIn(uri, skip))) continue;
        assets[path] = await vscode.workspace.fs.readFile(uri);
    }
    return assets;
}

const request = (client: BaseLanguageClient, params: ExportStoryParams) => client.sendRequest<ExportStoryResult>(EXPORT_STORY, params);

function showErrors(errors: string[]) {
    void vscode.window.showErrorMessage(`The story can't be exported until its errors are fixed: ${errors[0]}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ""}`);
}

// Asks where to save a single file, beside the story by default
async function saveDialog(root: vscode.Uri, title: string, name: string, filters: Record<string, string[]>) {
    return vscode.window.showSaveDialog({ title, defaultUri: vscode.Uri.joinPath(root, name), filters, saveLabel: "Export" });
}

export async function exportStory(client: BaseLanguageClient, storyUri: vscode.Uri) {
    const result = await request(client, { uri: storyUri.toString() });
    if (!result.success) {
        showErrors(result.errors);
        return;
    }
    const root = vscode.Uri.parse(result.root);

    const choice = await vscode.window.showQuickPick([
        { label: "To a folder", description: "index.html, story.js and the story's files", to: "folder" as const },
        { label: "As a zip", description: "The same files in a zip, to upload to a website", to: "zip" as const },
        { label: "As a single HTML file", description: "One page with everything in it, to share or open in a browser", to: "html" as const },
        { label: "Only story.js", description: "The story's code, for a page of your own", to: "js" as const },
    ], { title: "Export the story" });
    if (!choice) return;

    if (choice.to == "js") {
        const target = await saveDialog(root, "Export the story's script", "story.js", { "JavaScript files": ["js"] });
        if (!target) return;
        await vscode.workspace.fs.writeFile(target, strToU8(result.files["story.js"]));
        void vscode.window.showInformationMessage(`Exported the story's script to ${describe(target)}.`);
        return;
    }

    if (choice.to == "html") {
        const target = await saveDialog(root, "Export the story as a single HTML file", fileName(result.title, ".html"), { "HTML files": ["html"] });
        if (!target) return;
        const assets = await storyAssets(root, target);
        const single = await request(client, {
            uri: storyUri.toString(),
            inlineAssets: Object.fromEntries(Object.entries(assets).map(([path, bytes]) => [path, toBase64(bytes)])),
        });
        if (!single.success) {
            showErrors(single.errors);
            return;
        }
        await vscode.workspace.fs.writeFile(target, strToU8(single.files["index.html"]));
        // A browser can open the page from disk, on the desktop
        const canOpen = target.scheme == "file" && vscode.env.uiKind == vscode.UIKind.Desktop;
        const action = await vscode.window.showInformationMessage(`Exported the story to ${describe(target)}.`, ...(canOpen ? ["Open in Browser"] : []));
        if (action) void vscode.env.openExternal(target);
        return;
    }

    if (choice.to == "zip") {
        const target = await saveDialog(root, "Export the story as a zip", fileName(result.title, ".zip"), { "Zip files": ["zip"] });
        if (!target) return;
        const assets = await storyAssets(root, target);
        const zip = zipSync({
            ...assets,
            // The packager's files take precedence over any asset with the same name, as in its zip
            ...Object.fromEntries(Object.entries(result.files).map(([name, text]) => [name, strToU8(text)])),
        });
        await vscode.workspace.fs.writeFile(target, zip);
        void vscode.window.showInformationMessage(`Exported the story to ${describe(target)}.`);
        return;
    }

    // The build folder by default, as the command-line tool builds into, which isn't part of the
    // story. The dialog needs it to be there to start in it, so it's made, and taken away again
    // if it's left empty.
    const build = vscode.Uri.joinPath(root, BUILD_FOLDER);
    const madeBuild = !(await exists(build));
    if (madeBuild) {
        try {
            await vscode.workspace.fs.createDirectory(build);
        }
        catch {
            // The dialog starts in the story's folder instead
        }
    }
    const picked = await vscode.window.showOpenDialog({
        title: "Export the story to a folder",
        defaultUri: await exists(build) ? build : root,
        canSelectFiles: false,
        canSelectFolders: true,
        openLabel: "Export Here",
    });
    let folder = picked?.[0];
    if (folder && sameFolder(folder, root)) {
        // Next to the story's own files, a published style.css would replace one of the author's,
        // and then be left out of the story as an old build
        const answer = await vscode.window.showWarningMessage(
            `Export into the story's own folder? index.html, story.js, style.css and the Squiffy runtime would go next to your script, replacing any files of yours with those names. The ${BUILD_FOLDER} folder keeps them apart.`,
            { modal: true }, `Export to ${BUILD_FOLDER}`, "Export Here");
        if (answer == `Export to ${BUILD_FOLDER}`) {
            await vscode.workspace.fs.createDirectory(build);
            folder = build;
        }
        else if (answer != "Export Here") folder = undefined;
    }
    if (madeBuild && (!folder || !sameFolder(folder, build))) {
        try {
            if (!(await vscode.workspace.fs.readDirectory(build)).length) await vscode.workspace.fs.delete(build);
        }
        catch {
            // It's already gone
        }
    }
    if (!folder) return;
    const intoRoot = sameFolder(folder, root);
    // Its assets are already in the story's own folder
    const assets = intoRoot ? {} : await storyAssets(root, folder);
    const clashes = [];
    for (const name of new Set([...Object.keys(result.files), ...Object.keys(assets)])) {
        if (await exists(vscode.Uri.joinPath(folder, name))) clashes.push(name);
    }
    // Replacing an asset in the story's folder with itself is no change, but its index.html could
    // be the author's own
    if (clashes.length) {
        const replace = await vscode.window.showWarningMessage(
            `${describe(folder)} already has ${clashMessage(clashes)}. Replace ${clashes.length == 1 ? "it" : "them"}?`,
            { modal: true }, "Replace");
        if (replace != "Replace") return;
    }
    for (const [name, bytes] of Object.entries(assets)) {
        if (name in result.files) continue;
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, name), bytes);
    }
    for (const [name, text] of Object.entries(result.files)) {
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, name), strToU8(text));
    }
    const index = vscode.Uri.joinPath(folder, "index.html");
    // A browser can open the page from disk, on the desktop
    const canOpen = index.scheme == "file" && vscode.env.uiKind == vscode.UIKind.Desktop;
    const action = await vscode.window.showInformationMessage(`Exported the story to ${describe(folder)}.`, ...(canOpen ? ["Open in Browser"] : []));
    if (action) void vscode.env.openExternal(index);
}

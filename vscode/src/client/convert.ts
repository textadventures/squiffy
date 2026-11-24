// Squiffy: Convert Twine Story and Convert Quest Gamebook: picks the file and a folder for the
// new story, converts it (convert-story.ts), writes the story with workspace.fs, so it works on
// vscode.dev too, and opens its main file.

import * as vscode from "vscode";
import {
    convertedMessage, convertQuestFile, convertTwineFile, QUEST_EXTENSIONS, storyFolderName, TWINE_EXTENSIONS,
    type ConvertedStory,
} from "./convert-story.js";

const exists = async (uri: vscode.Uri) => {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    }
    catch {
        return false;
    }
};

const isEmptyFolder = async (uri: vscode.Uri) => {
    try {
        return (await vscode.workspace.fs.readDirectory(uri)).length == 0;
    }
    catch {
        return false;
    }
};

const fileName = (uri: vscode.Uri) => uri.path.slice(uri.path.lastIndexOf("/") + 1);
const parentFolder = (uri: vscode.Uri) => vscode.Uri.joinPath(uri, "..");
// A folder's path from the workspace, or its name if it's a workspace folder itself
const folderName = (uri: vscode.Uri) => {
    const relative = vscode.workspace.asRelativePath(uri, false);
    if (relative && relative != uri.toString() && relative != uri.fsPath) return relative;
    return vscode.workspace.getWorkspaceFolder(uri)?.name ?? (fileName(uri) || uri.toString());
};

// The folder to put the new story in: the one the author picks if it's empty, else a new folder
// in it, named after the file, as the command-line tool names it
async function pickStoryFolder(source: vscode.Uri): Promise<vscode.Uri | undefined> {
    const picked = (await vscode.window.showOpenDialog({
        title: "Choose a folder for the converted story",
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri ?? parentFolder(source),
        canSelectFiles: false,
        canSelectFolders: true,
        openLabel: "Convert Here",
    }))?.[0];
    if (!picked || await isEmptyFolder(picked)) return picked;
    const folder = vscode.Uri.joinPath(picked, storyFolderName(fileName(source)));
    if (await exists(folder) && !await isEmptyFolder(folder)) {
        void vscode.window.showErrorMessage(`${folderName(picked)} isn't empty, and nor is ${folderName(folder)}. Choose an empty folder for the story.`);
        return undefined;
    }
    const create = await vscode.window.showInformationMessage(
        `${folderName(picked)} isn't empty. Put the story in a new folder in it, called "${fileName(folder)}"?`,
        { modal: true }, "Create Folder");
    return create ? folder : undefined;
}

async function writeStory(folder: vscode.Uri, converted: ConvertedStory) {
    await vscode.workspace.fs.createDirectory(folder);
    for (const [path, content] of converted.files) {
        const uri = vscode.Uri.joinPath(folder, ...path.split("/"));
        // createDirectory makes any folders above it too
        if (path.includes("/")) await vscode.workspace.fs.createDirectory(parentFolder(uri));
        await vscode.workspace.fs.writeFile(uri, typeof content == "string" ? new TextEncoder().encode(content) : content);
    }
    const main = vscode.Uri.joinPath(folder, converted.main);
    await vscode.window.showTextDocument(main);

    const message = convertedMessage(converted);
    const actions: string[] = [];
    if (converted.problems > 0) actions.push("Show List");
    const outside = !vscode.workspace.getWorkspaceFolder(main);
    if (outside) actions.push("Open Folder");
    const show = converted.problems > 0 ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    void show(outside ? `${message} The story isn't in the open folder: open its folder to work on it.` : message, ...actions).then(action => {
        if (action == "Show List") void vscode.window.showTextDocument(vscode.Uri.joinPath(folder, converted.problemsFile));
        if (action == "Open Folder") void vscode.commands.executeCommand("vscode.openFolder", folder);
    });
}

async function convertFile(
    title: string, filters: Record<string, string[]>,
    convert: (source: vscode.Uri, data: Uint8Array) => ConvertedStory | Promise<ConvertedStory>,
) {
    const source = (await vscode.window.showOpenDialog({
        title,
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters,
        openLabel: "Convert",
    }))?.[0];
    if (!source) return;
    let converted: ConvertedStory;
    try {
        converted = await convert(source, await vscode.workspace.fs.readFile(source));
    }
    catch (e) {
        void vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
        return;
    }
    const folder = await pickStoryFolder(source);
    if (folder) await writeStory(folder, converted);
}

export const convertTwineStory = () => convertFile(
    "Choose a Twine story to convert",
    { "Twine stories": TWINE_EXTENSIONS, "All files": ["*"] },
    (source, data) => convertTwineFile(fileName(source), new TextDecoder().decode(data)),
);

export const convertQuestGamebook = () => convertFile(
    "Choose a Quest gamebook to convert",
    { "Quest games": QUEST_EXTENSIONS, "All files": ["*"] },
    (source, data) => convertQuestFile(fileName(source), data, async path => {
        // A .aslx file's images and sounds, from its folder
        const uri = vscode.Uri.joinPath(parentFolder(source), ...path.split("/"));
        try {
            return await vscode.workspace.fs.readFile(uri);
        }
        catch {
            return undefined;
        }
    }),
);

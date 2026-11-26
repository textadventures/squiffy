// Squiffy: Share as a Link, and Play in Browser: the whole story in a squiffystories.com link, as
// the editor's Share or publish makes it ("A link"), with the same encoding and limits
// (app/src/lib/story-link.ts, which uses player/src/link.ts). Nothing is uploaded: the link is the
// story, so only a small story fits, with its text files and any small images.

import * as vscode from "vscode";
import type { BaseLanguageClient } from "vscode-languageclient";
import { BUILD_FOLDER } from "squiffy-compiler";
import { isStoryText } from "@textadventures/squiffy-player/link";
import { createStoryLink, MAX_ASSET_BYTES, playerFolder, SHORT_LINK_LENGTH, type StoryLink } from "@textadventures/squiffy-app/story-link";
import { EXPORT_STORY, type ExportStoryParams, type ExportStoryResult } from "../protocol.js";
import { listFiles, readText } from "./files.js";

// Where stories are played from a link. The editor's development build uses a local player, but
// the extension's links are always for the real one, as they're for sending to people.
export const PLAYER_ORIGIN = "https://squiffystories.com";

// Which of the files in a story's folder (paths from it) can go in its link: not an earlier export
// in the main file's build folder, or the story's playthrough tests and backups
export function linkPaths(paths: string[], mainFile: string): string[] {
    const build = mainFile.slice(0, mainFile.lastIndexOf("/") + 1) + BUILD_FOLDER + "/";
    return paths.filter(path => !path.startsWith(build) && !/\.(squiffy-test|bak)$/i.test(path));
}

// The files left out of a link, in a sentence: the first few, and how many more
export function fileList(files: string[]): string {
    const shown = files.slice(0, 3).join(", ");
    return files.length > 3 ? `${shown} and ${files.length - 3} more` : shown;
}

// What to say about a link that's been copied
export function linkMessage(link: StoryLink, url: string): string {
    const parts = ["Copied a link to the story. Anyone who opens it can play it on squiffystories.com, and nothing has been uploaded. It plays the story as it is now: if you change the story, make a new link."];
    if (url.length > SHORT_LINK_LENGTH) {
        parts.push(`At ${url.length.toLocaleString("en")} characters, it's too long for some chat apps, which cut a long message short. It'll work in an email, or as a link on a web page.`);
    }
    if (link.leftOut.length) {
        parts.push(`Not in the link: ${fileList(link.leftOut)}. A link has room for the story's text and for images of up to ${MAX_ASSET_BYTES / 1024} KB each.`);
    }
    return parts.join(" ");
}

// The link for a story, or why there can't be one
async function makeLink(client: BaseLanguageClient, storyUri: vscode.Uri, version: string): Promise<StoryLink | { error: string }> {
    // A story that doesn't compile can't be played from its link either
    const result = await client.sendRequest<ExportStoryResult>(EXPORT_STORY, { uri: storyUri.toString() } satisfies ExportStoryParams);
    if (!result.success) {
        return { error: `The story can't be shared until this is fixed: ${result.errors[0]}${result.errors.length > 1 ? ` (and ${result.errors.length - 1} more)` : ""}` };
    }
    const root = vscode.Uri.parse(result.storyRoot);
    const files = new Map<string, string | Uint8Array>();
    for (const path of linkPaths(await listFiles(root), result.mainFile)) {
        const uri = vscode.Uri.joinPath(root, path);
        // Text with any unsaved changes, as the preview plays it
        files.set(path, isStoryText(path) ? await readText(uri) : await vscode.workspace.fs.readFile(uri));
    }
    return createStoryLink(files, result.mainFile, playerFolder(PLAYER_ORIGIN, version));
}

// An address to open, as it is. vscode.Uri.parse would encode the "=" in "#story=".
const external = (url: string) => url as unknown as vscode.Uri;

export async function shareLink(client: BaseLanguageClient, storyUri: vscode.Uri, version: string) {
    const link = await makeLink(client, storyUri, version);
    if ("error" in link) {
        void vscode.window.showErrorMessage(link.error);
        return;
    }
    await vscode.env.clipboard.writeText(link.url);
    const open = "Open in Browser";
    const noEdit = "Copy Without Edit Button";
    const action = await vscode.window.showInformationMessage(linkMessage(link, link.url), open, noEdit);
    if (action == open) {
        void vscode.env.openExternal(external(link.url));
    }
    else if (action == noEdit) {
        await vscode.env.clipboard.writeText(link.noEditUrl);
        void vscode.window.showInformationMessage("Copied the link without its Open in editor button. That only hides the button: the whole story is still in the link, so anyone who wants to can read it.");
    }
}

// The story in a browser tab, from its link, in place of the editor's Play in a new tab
export async function playInBrowser(client: BaseLanguageClient, storyUri: vscode.Uri, version: string) {
    const link = await makeLink(client, storyUri, version);
    if ("error" in link) {
        void vscode.window.showErrorMessage(link.error);
        return;
    }
    void vscode.env.openExternal(external(link.url));
    if (link.leftOut.length) {
        void vscode.window.showWarningMessage(`The story is playing from a link, which leaves out ${fileList(link.leftOut)}. Squiffy: Export makes a page with everything in it.`);
    }
}

// Squiffy: Publish to textadventures.co.uk, as the editor's Share or publish does it
// (app/src/lib/publish-api.ts): the published story is uploaded as a zip with no login, and
// textadventures.co.uk gives back a page where the author, signed in there, finishes publishing
// it. The extension then asks what became of the upload, to say when it's published. The story's
// ID in squiffy.json is how the site knows, next time, that it's an update to the same story, so
// a story without one is given one first, and a story without a squiffy.json is given one,
// which turns on Squiffy 7's rules for setters, so its setters are converted, as the editor does.

import * as vscode from "vscode";
import type { BaseLanguageClient } from "vscode-languageclient";
import { strToU8, zipSync } from "fflate";
import { BUILD_FOLDER, setterConversionMessage, updateProjectFile } from "squiffy-compiler";
import { checkStatus, DEFAULT_PUBLISH_API_URL, postStory, UploadError, type PublishClient, type PublishStatus, type Upload } from "@textadventures/squiffy-app/publish-api";
import { EXPORT_STORY, NEW_PROJECT_FILE, type ExportStoryParams, type ExportStoryResult, type NewProjectFileParams, type NewProjectFileResult } from "../protocol.js";
import { fileName, storyAssets } from "./export.js";

// How often to ask textadventures.co.uk whether the author has finished there, and for how long:
// an upload is kept for an hour
const POLL_INTERVAL = 3000;
const POLL_FOR = 60 * 60 * 1000;

// squiffy.json's text with an ID, if it hasn't one. Undefined if it isn't a JSON object, and
// null if it has an ID already.
export function withStoryId(text: string, id: string): string | undefined | null {
    let json: unknown;
    try {
        json = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    if (!json || typeof json != "object" || Array.isArray(json)) return undefined;
    const existing = (json as { id?: unknown }).id;
    if (typeof existing == "string" && existing.trim()) return null;
    return updateProjectFile(text, { id });
}

// Which editor is publishing, for textadventures.co.uk's own figures
export function publishClient(version: string, uiKind: vscode.UIKind): PublishClient {
    return { source: "vscode", version, platform: uiKind == vscode.UIKind.Web ? "web" : "desktop" };
}

const exportRequest = (client: BaseLanguageClient, params: ExportStoryParams) => client.sendRequest<ExportStoryResult>(EXPORT_STORY, params);

const errorsMessage = (errors: string[]) =>
    `The story can't be published until this is fixed: ${errors[0]}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ""}`;

// An address to open, as it is (vscode.Uri.parse could encode some of it)
const external = (url: string) => url as unknown as vscode.Uri;

// Gives the story an ID in its squiffy.json, saving it. Says why it couldn't, if it couldn't.
async function addStoryId(projectFile: vscode.Uri): Promise<string | null> {
    const document = await vscode.workspace.openTextDocument(projectFile);
    const text = withStoryId(document.getText(), crypto.randomUUID());
    if (text === undefined) return "squiffy.json couldn't be read. Fix it, then try again.";
    if (text === null) return null;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(projectFile, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
    if (!(await vscode.workspace.applyEdit(edit)) || !(await document.save())) return "Couldn't give the story an ID in squiffy.json.";
    return null;
}

// What to say about a new squiffy.json
export function projectFileMessage(added: { exclude: string[]; converted: number; problems: string[] }): string {
    const exclude = added.exclude.length
        ? ` It leaves out the folder's files that aren't part of this story: ${added.exclude.slice(0, 3).join(", ")}${added.exclude.length > 3 ? ` and ${added.exclude.length - 3} more` : ""}.`
        : "";
    const converted = setterConversionMessage(added.converted, added.problems);
    return `Added squiffy.json, so textadventures.co.uk knows next time that it's the same story.${exclude}${converted ? ` ${converted}` : ""}`;
}

// Gives a story with no squiffy.json one, converting its setters. Says why it couldn't, if it couldn't.
async function addProjectFile(client: BaseLanguageClient, storyUri: vscode.Uri): Promise<{ uri: vscode.Uri } | { error: string }> {
    const added = await client.sendRequest<NewProjectFileResult>(NEW_PROJECT_FILE, { uri: storyUri.toString() } satisfies NewProjectFileParams);
    if (!added.success) return { error: errorsMessage(added.errors) };
    // The setters first, as squiffy.json turns their new rules on. One edit, so Undo puts them back.
    const documents = await Promise.all(Object.keys(added.changes).map(uri => vscode.workspace.openTextDocument(vscode.Uri.parse(uri))));
    if (documents.length) {
        const edit = new vscode.WorkspaceEdit();
        for (const document of documents) {
            edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), added.changes[document.uri.toString()]);
        }
        if (!(await vscode.workspace.applyEdit(edit))) return { error: "Couldn't convert the story's setters to Squiffy 7's rules." };
        for (const document of documents) await document.save();
    }
    const uri = vscode.Uri.parse(added.uri);
    await vscode.workspace.fs.writeFile(uri, strToU8(added.text));
    const message = projectFileMessage(added);
    if (added.problems.length) void vscode.window.showWarningMessage(message);
    else void vscode.window.showInformationMessage(message);
    return { uri };
}

// The story waiting to be published on textadventures.co.uk, if there is one: a new upload stops
// the last one's waiting
let waiting: AbortController | undefined;

export function stopWaiting() {
    waiting?.abort();
}

export async function publishOnline(client: BaseLanguageClient, storyUri: vscode.Uri, version: string) {
    let result = await exportRequest(client, { uri: storyUri.toString() });
    if (!result.success) {
        void vscode.window.showErrorMessage(errorsMessage(result.errors));
        return;
    }
    if (!result.projectFile) {
        const added = await addProjectFile(client, storyUri);
        if ("error" in added) {
            void vscode.window.showErrorMessage(added.error);
            return;
        }
        result = await exportRequest(client, { uri: storyUri.toString(), changed: added.uri.toString() });
        if (!result.success) {
            void vscode.window.showErrorMessage(errorsMessage(result.errors));
            return;
        }
    }
    else if (!result.id) {
        const projectFile = vscode.Uri.parse(result.projectFile);
        const problem = await addStoryId(projectFile);
        if (problem) {
            void vscode.window.showErrorMessage(problem);
            return;
        }
        result = await exportRequest(client, { uri: storyUri.toString(), changed: projectFile.toString() });
        if (!result.success) {
            void vscode.window.showErrorMessage(errorsMessage(result.errors));
            return;
        }
        void vscode.window.showInformationMessage("Gave the story an ID in squiffy.json, so textadventures.co.uk knows next time that it's the same story. Keep it, to update the story by publishing again.");
    }

    const root = vscode.Uri.parse(result.root);
    const files = result.files;
    const title = result.title;
    // As Export's zip, without an earlier export in the build folder
    const assets = await storyAssets(root, vscode.Uri.joinPath(root, BUILD_FOLDER));
    const zip = zipSync({ ...assets, ...Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])) });

    let upload: Upload;
    try {
        upload = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Uploading the story to textadventures.co.uk…",
            cancellable: true,
        }, (_progress, token) => {
            const abort = new AbortController();
            token.onCancellationRequested(() => abort.abort());
            return postStory(zip, fileName(title, ".zip"), publishClient(version, vscode.env.uiKind), DEFAULT_PUBLISH_API_URL, abort.signal);
        });
    }
    catch (err) {
        if (err instanceof UploadError) void vscode.window.showErrorMessage(err.message);
        else if (!(err instanceof Error && err.name == "AbortError")) void vscode.window.showErrorMessage("Couldn't publish the story. Try again later.");
        return;
    }

    void vscode.env.openExternal(external(upload.claimUrl));
    const again = "Continue on textadventures.co.uk";
    void vscode.window.showInformationMessage(
        "Your story is uploaded. To finish, log in and publish it on textadventures.co.uk, in the page that's opened in your browser. The upload is kept for an hour.",
        again,
    ).then(action => {
        if (action == again) void vscode.env.openExternal(external(upload.claimUrl));
    });

    waiting?.abort();
    const abort = waiting = new AbortController();
    const status = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: "Waiting for the story to be published on textadventures.co.uk",
    }, () => waitForPublishing(upload.id, abort.signal));
    if (waiting == abort) waiting = undefined;
    if (status?.status == "published") {
        const see = "See It on textadventures.co.uk";
        const gameUrl = status.gameUrl;
        const action = await vscode.window.showInformationMessage("Your story is published on textadventures.co.uk.", ...(gameUrl ? [see] : []));
        if (action == see && gameUrl) void vscode.env.openExternal(external(gameUrl));
    }
    else if (status?.status == "gone") {
        void vscode.window.showErrorMessage("The story wasn't published within an hour of being uploaded, so it needs publishing again.");
    }
}

// Asks textadventures.co.uk what became of an upload until it's published or gone, for up to an
// hour. Undefined if it stopped asking before then.
export async function waitForPublishing(
    id: string, signal: AbortSignal,
    options: { check?: (id: string) => Promise<PublishStatus | null>; interval?: number; timeout?: number } = {},
): Promise<PublishStatus | undefined> {
    const check = options.check ?? (upload => checkStatus(upload, DEFAULT_PUBLISH_API_URL));
    const end = Date.now() + (options.timeout ?? POLL_FOR);
    while (!signal.aborted && Date.now() < end) {
        await new Promise<void>(resolve => {
            const timer = setTimeout(resolve, options.interval ?? POLL_INTERVAL);
            signal.addEventListener("abort", () => {
                clearTimeout(timer);
                resolve();
            }, { once: true });
        });
        if (signal.aborted) return undefined;
        const status = await check(id);
        if (status && status.status != "pending") return status;
    }
    return undefined;
}

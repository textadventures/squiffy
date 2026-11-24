// The live preview: the story running in a webview beside the editor, from squiffy-runtime's
// preview page, updating as you type. It follows the story of the active .squiffy editor.

import * as vscode from "vscode";
import type { BaseLanguageClient } from "vscode-languageclient";
import { previewHtml } from "squiffy-runtime/preview-html";
import { createPreviewHost, type PreviewChannel, type PreviewHost, type StartAt } from "squiffy-runtime/preview-host";
import { PREVIEW_STORY, type PreviewStoryParams, type PreviewStoryResult } from "../protocol.js";
import { isStoryFile, listFiles } from "./files.js";

// How long to wait after typing before updating the preview
const UPDATE_DELAY = 300;

const previewTheme = (kind: vscode.ColorThemeKind) =>
    kind == vscode.ColorThemeKind.Light || kind == vscode.ColorThemeKind.HighContrastLight ? "light" : "dark";

export class Preview implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private host: PreviewHost | undefined;
    // A file in the story being previewed
    private storyUri: vscode.Uri | undefined;
    // The folder the story's assets are found from
    private root: string | undefined;
    private running = false;
    private updateTimer: ReturnType<typeof setTimeout> | undefined;
    // Updates are compiled one at a time, so an older compile can't land after a newer one
    private queue: Promise<void> = Promise.resolve();
    private disposables: vscode.Disposable[] = [];
    private log: vscode.OutputChannel;

    constructor(private client: BaseLanguageClient, log: vscode.OutputChannel) {
        this.log = log;
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(e => {
                if (this.isInStory(e.document.uri)) this.scheduleUpdate();
            }),
            vscode.window.onDidChangeActiveTextEditor(editor => {
                // Another story's file: preview that story instead
                if (!this.panel || editor?.document.languageId != "squiffy") return;
                if (this.root && editor.document.uri.toString().startsWith(this.root)) return;
                void this.show(editor.document.uri);
            }),
            vscode.window.onDidChangeActiveColorTheme(theme => this.host?.setTheme(previewTheme(theme.kind))),
        );
        // Files changed outside the editor, such as images added, or a file the story @imports
        const watcher = vscode.workspace.createFileSystemWatcher("**/*");
        const changed = (uri: vscode.Uri) => {
            if (!this.isInStory(uri)) return;
            if (/\.(squiffy|css|js)$/.test(uri.path)) this.scheduleUpdate();
            else void this.sendAssets();
        };
        this.disposables.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
    }

    private isInStory(uri: vscode.Uri) {
        return !!this.panel && !!this.root && uri.toString().startsWith(this.root);
    }

    // Shows the preview of the story a file is part of, starting it again
    async show(uri: vscode.Uri, startAt?: StartAt) {
        this.storyUri = uri;
        if (!this.panel) this.createPanel();
        else this.panel.reveal(vscode.ViewColumn.Beside, true);
        await this.run(startAt);
    }

    restart() {
        this.host?.restart();
    }

    back() {
        this.host?.back();
    }

    private createPanel() {
        const panel = vscode.window.createWebviewPanel("squiffy.preview", "Squiffy Preview", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [],
        });
        const html = withCsp(previewHtml, panel.webview.cspSource);
        panel.webview.html = html;
        let reloads = 0;
        const channel: PreviewChannel = {
            send: message => {
                // The host asks the page to reload before loading a story again after one with
                // scripts. A webview's page can't reload itself (it goes blank), but setting its
                // HTML reloads it. VS Code skips setting the same HTML, so each time is different.
                if (isReload(message)) panel.webview.html = `${html}\n<!-- ${++reloads} -->`;
                else void panel.webview.postMessage(message);
            },
            onMessage: handler => {
                const subscription = panel.webview.onDidReceiveMessage(handler);
                return () => subscription.dispose();
            },
        };
        let pageStarted = false;
        this.host = createPreviewHost(channel, {
            // A later ready means the webview reloaded the page and lost the story
            onReady: () => {
                if (pageStarted && this.running) void this.run();
                pageStarted = true;
            },
            onCanGoBackChanged: canGoBack => void vscode.commands.executeCommand("setContext", "squiffyPreviewCanGoBack", canGoBack),
            onAttributeSet: (name, value) => this.log.appendLine(`${name} = ${JSON.stringify(value)}`),
            onRuntimeError: (message, stack) => {
                this.log.appendLine(`Error: ${stack ?? message}`);
                void vscode.window.showErrorMessage(`The story stopped with an error: ${message}`);
            },
        });
        this.host.setTheme(previewTheme(vscode.window.activeColorTheme.kind));
        panel.onDidDispose(() => {
            this.host?.dispose();
            this.host = undefined;
            this.panel = undefined;
            this.root = undefined;
            this.running = false;
            void vscode.commands.executeCommand("setContext", "squiffyPreviewOpen", false);
        });
        void vscode.commands.executeCommand("setContext", "squiffyPreviewOpen", true);
        this.panel = panel;
    }

    private compile() {
        return this.client.sendRequest<PreviewStoryResult>(PREVIEW_STORY, { uri: this.storyUri!.toString() } satisfies PreviewStoryParams);
    }

    // Starts the story, from the start or from a section
    private async run(startAt?: StartAt) {
        const result = await this.compile();
        if (!this.host || !this.panel) return;
        this.root = result.root;
        if (!result.success) {
            this.showErrors(result.errors);
            return;
        }
        this.log.clear();
        await this.sendAssets();
        this.host.load({ js: result.js, css: result.css, scripts: result.scripts }, startAt ? { startAt } : {});
        this.running = true;
    }

    private scheduleUpdate() {
        clearTimeout(this.updateTimer);
        this.updateTimer = setTimeout(() => this.update(), UPDATE_DELAY);
    }

    // Hot-updates the running story after an edit, keeping its state
    private update() {
        this.queue = this.queue.then(async () => {
            if (!this.host || !this.storyUri) return;
            const result = await this.compile();
            if (!result.success) {
                this.showErrors(result.errors);
                return;
            }
            if (!this.running) await this.run();
            // With the story's stylesheets, so a CSS change shows without a restart. Its scripts
            // can't be swapped into a running story, so those only change on Restart.
            else this.host?.update(result.js, result.css);
        });
    }

    // The story's assets (images, sounds, fonts...), as URLs the webview can load
    private async sendAssets() {
        if (!this.host || !this.panel || !this.root) return;
        const root = vscode.Uri.parse(this.root);
        const urls: Record<string, string> = {};
        for (const path of await listFiles(root)) {
            if (isStoryFile(path)) continue;
            urls[path] = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(root, path)).toString();
        }
        this.host.setAssets({ urls });
    }

    private showErrors(errors: string[]) {
        this.log.appendLine("The story can't run until these errors are fixed:");
        for (const error of errors) this.log.appendLine(error);
        void vscode.window.showWarningMessage("The story has errors, so the preview can't run it. See the Problems panel.");
    }

    dispose() {
        clearTimeout(this.updateTimer);
        this.panel?.dispose();
        for (const d of this.disposables) d.dispose();
    }
}

const isReload = (message: unknown) =>
    typeof message == "object" && message !== null && (message as { type?: unknown }).type == "reload";

// The preview page with a Content Security Policy: its own inline script and styles, the story
// as a blob: module, and assets from the workspace. The webview is already isolated from VS Code,
// so this only keeps the story from loading scripts from elsewhere.
export function withCsp(html: string, cspSource: string) {
    const csp = [
        "default-src 'none'",
        `img-src ${cspSource} blob: data: https:`,
        `media-src ${cspSource} blob: data: https:`,
        `font-src ${cspSource} blob: data: https:`,
        `style-src ${cspSource} 'unsafe-inline' https:`,
        // Handlebars compiles the story's text with new Function
        "script-src 'unsafe-inline' 'unsafe-eval' blob:",
    ].join("; ");
    return html.replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
}

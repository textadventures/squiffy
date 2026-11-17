// The host side of the Squiffy preview: drives a preview page in a sandboxed iframe (the editor
// and desktop app) or a VS Code webview. It has no runtime code in it.
//
//     import { previewHtml } from "squiffy-runtime/preview-html";
//     import { createPreviewHost, iframeChannel, setUpPreviewFrame } from "squiffy-runtime/preview-host";
//
//     setUpPreviewFrame(iframe, previewHtml);
//     const preview = createPreviewHost(iframeChannel(iframe), {
//         onNavigated: (section, passage) => ...,
//     });
//     await preview.setAssets({ files: { "cat.png": blob } });
//     await preview.load({ js: await result.getJs() }, { startAt: { section: "kitchen" } });

import {
    Envelope, HostMessage, isEnvelope, PREVIEW_CHANNEL, PreviewAssets, PreviewMessage, PreviewStory, PreviewTheme, StartAt,
} from "./preview-protocol.js";

export type { HostMessage, PreviewAssets, PreviewMessage, PreviewStory, PreviewTheme, StartAt } from "./preview-protocol.js";
export { PREVIEW_CHANNEL } from "./preview-protocol.js";

// How the host talks to the preview page
export interface PreviewChannel {
    send(message: Envelope<HostMessage>): void;
    // Calls handler with each message from the page. Returns a function that stops listening.
    onMessage(handler: (data: unknown) => void): () => void;
}

export interface PreviewHandlers {
    onReady?(): void;
    onLoaded?(): void;
    onAttributeSet?(name: string, value: unknown): void;
    onCanGoBackChanged?(canGoBack: boolean): void;
    onNavigated?(section: string, passage?: string): void;
    onRuntimeError?(message: string, stack?: string): void;
}

export interface PreviewHost {
    // Resolves when the page has loaded. Messages sent before that are queued.
    readonly ready: Promise<void>;
    // Starts a story, replacing any that's running
    load(story: PreviewStory, options?: { startAt?: StartAt }): void;
    // Hot-updates the running story, keeping its state
    update(js: string): void;
    restart(): void;
    back(): void;
    // Sets the assets the story can use. Send these before load().
    setAssets(assets: PreviewAssets): void;
    // Shows the story in light or dark mode. It's kept if the page reloads.
    setTheme(theme: PreviewTheme): void;
    dispose(): void;
}

// Sandboxes an iframe and loads the preview page into it. The sandbox allows scripts only, so the
// story runs with an opaque origin: it can't reach the host page, its storage or its cookies.
export function setUpPreviewFrame(iframe: HTMLIFrameElement, previewHtml: string) {
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.srcdoc = previewHtml;
}

// A channel to a preview page in an iframe
export function iframeChannel(iframe: HTMLIFrameElement): PreviewChannel {
    return {
        // The page has an opaque origin, so there's no origin to target
        send: message => iframe.contentWindow?.postMessage(message, "*"),
        onMessage(handler) {
            const listener = (event: MessageEvent) => {
                if (event.source === iframe.contentWindow) handler(event.data);
            };
            window.addEventListener("message", listener);
            return () => window.removeEventListener("message", listener);
        },
    };
}

export function createPreviewHost(channel: PreviewChannel, handlers: PreviewHandlers = {}): PreviewHost {
    let isReady = false;
    let queue: HostMessage[] = [];
    let theme: PreviewTheme | undefined;
    let resolveReady: () => void;
    const ready = new Promise<void>(resolve => { resolveReady = resolve; });

    const send = (message: HostMessage) => {
        if (isReady) channel.send({ channel: PREVIEW_CHANNEL, ...message });
        else queue.push(message);
    };

    const stop = channel.onMessage(data => {
        if (!isEnvelope<PreviewMessage>(data)) return;
        const message = data as Envelope<PreviewMessage>;
        switch (message.type) {
            case "ready": {
                // Sent again if the page reloads, which loses its story, so onReady is
                // where a host can load it again
                isReady = true;
                if (theme) send({ type: "theme", theme });
                const queued = queue;
                queue = [];
                for (const m of queued) send(m);
                resolveReady();
                handlers.onReady?.();
                break;
            }
            case "loaded":
                handlers.onLoaded?.();
                break;
            case "attributeSet":
                handlers.onAttributeSet?.(message.name, message.value);
                break;
            case "canGoBackChanged":
                handlers.onCanGoBackChanged?.(message.canGoBack);
                break;
            case "navigated":
                handlers.onNavigated?.(message.section, message.passage);
                break;
            case "runtimeError":
                handlers.onRuntimeError?.(message.message, message.stack);
                break;
        }
    });

    return {
        ready,
        load: (story, options = {}) => send({ type: "load", story, ...(options.startAt ? { startAt: options.startAt } : {}) }),
        update: js => send({ type: "update", js }),
        restart: () => send({ type: "restart" }),
        back: () => send({ type: "back" }),
        setAssets: assets => send({ type: "assets", assets }),
        setTheme: value => {
            theme = value;
            // Sent when the page is ready, and again if it reloads
            if (isReady) send({ type: "theme", theme });
        },
        dispose: () => {
            stop();
            queue = [];
        },
    };
}

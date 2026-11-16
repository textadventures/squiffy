// The entry point of the preview page (squiffy.preview.html), which is built as one
// self-contained file. It talks to its host with postMessage: to the parent window when it's in
// an iframe, or through acquireVsCodeApi() in a VS Code webview.

import { createPreview, errorMessage } from "./preview.js";
import { Envelope, HostMessage, isEnvelope, PREVIEW_CHANNEL, PreviewMessage } from "./preview-protocol.js";

declare const acquireVsCodeApi: undefined | (() => { postMessage(message: unknown): void });

const vscode = typeof acquireVsCodeApi == "function" ? acquireVsCodeApi() : undefined;

const post = (message: PreviewMessage) => {
    const envelope: Envelope<PreviewMessage> = { channel: PREVIEW_CHANNEL, ...message };
    if (vscode) vscode.postMessage(envelope);
    else window.parent.postMessage(envelope, "*");
};

const preview = createPreview({
    element: document.getElementById("squiffy")!,
    send: post,
});

window.addEventListener("message", event => {
    // In an iframe, only the parent can drive the preview
    if (!vscode && event.source !== window.parent) return;
    if (!isEnvelope<HostMessage>(event.data)) return;
    preview.receive(event.data);
});

window.addEventListener("error", event => post(errorMessage(event.error ?? event.message)));
window.addEventListener("unhandledrejection", event => post(errorMessage(event.reason)));

post({ type: "ready" });

// The story map's webview page: mounts the map and passes messages between it and the extension
// (client/map.ts). Bundled by Vite into dist/map/, with its stylesheet.

import { mount } from "svelte";
import StoryMap from "./StoryMap.svelte";
import type { FromMap, ToMap } from "./messages.js";
import "./map.css";

const vscode = acquireVsCodeApi();

const map = mount(StoryMap, {
    target: document.body,
    props: { post: (message: FromMap) => vscode.postMessage(message) },
});
window.addEventListener("message", (e: MessageEvent<ToMap>) => map.receive(e.data));
vscode.postMessage({ type: "ready" } satisfies FromMap);

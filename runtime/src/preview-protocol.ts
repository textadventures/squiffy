// The messages between a host (the editor, the desktop app or a VS Code extension) and the
// Squiffy preview page, which runs stories in a sandboxed frame or webview. See preview-host.ts
// for the host side and preview.ts for the page.

import type { StartAt } from "./types.js";

export type { StartAt } from "./types.js";

// Every message carries this, so each side can ignore unrelated messages.
export const PREVIEW_CHANNEL = "squiffy-preview";

export interface PreviewStory {
    // The compiled story module: the output of the compiler's getJs() without globalJs, which
    // starts "export const story".
    js: string;
    // The contents of the story's own stylesheets and scripts (from @import of .css and .js files).
    css?: string[];
    scripts?: string[];
}

export interface PreviewAssets {
    // Asset contents by path, as the story refers to them (relative to the main .squiffy file).
    // The preview makes its own object URLs for these: a sandboxed frame can't load the host's
    // blob URLs.
    files?: Record<string, Blob | ArrayBuffer | Uint8Array>;
    // Or URLs the preview can load as they are, e.g. from VS Code's asWebviewUri.
    urls?: Record<string, string>;
}

// "system" follows the reader's system setting, like an exported story
export type PreviewTheme = "light" | "dark" | "system";

export type HostMessage =
    // Starts a story, replacing any that's running. Send assets first.
    | { type: "load"; story: PreviewStory; startAt?: StartAt }
    // Hot-updates the running story, keeping its state
    | { type: "update"; js: string }
    | { type: "restart" }
    | { type: "back" }
    // Replaces the assets the story can use
    | { type: "assets"; assets: PreviewAssets }
    // Shows the story in light or dark mode, e.g. to match the host's own theme. A story's own
    // CSS can still override it, e.g. with ":root { color-scheme: light; }".
    | { type: "theme"; theme: PreviewTheme };

export type PreviewMessage =
    // The page has loaded and is listening
    | { type: "ready" }
    // A story from a load message has started
    | { type: "loaded" }
    // An attribute was set. Internal attributes, whose names start with "_", aren't sent.
    | { type: "attributeSet"; name: string; value: unknown }
    | { type: "canGoBackChanged"; canGoBack: boolean }
    // A section or passage was shown, or Back went to one
    | { type: "navigated"; section: string; passage?: string }
    // An error from the story's JavaScript or the runtime
    | { type: "runtimeError"; message: string; stack?: string };

export type Envelope<T> = T & { channel: typeof PREVIEW_CHANNEL };

export const isEnvelope = <T extends { type: string }>(data: unknown): data is Envelope<T> =>
    typeof data == "object" && data !== null && (data as { channel?: unknown }).channel === PREVIEW_CHANNEL
    && typeof (data as { type?: unknown }).type == "string";

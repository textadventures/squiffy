// The preview page's logic: runs stories sent by a host, and reports back what happens. The
// page itself (preview.main.ts) connects this to postMessage; it's separate so it can be tested.

import { init } from "./squiffy.runtime.js";
import type { HostMessage, PreviewAssets, PreviewMessage, PreviewStory } from "./preview-protocol.js";
import type { SquiffyApi, Story } from "./types.js";

export interface PreviewOptions {
    // Where to show the story
    element: HTMLElement;
    send(message: PreviewMessage): void;
    // Loads a compiled story module. By default it's imported from a blob URL, so story
    // JavaScript runs without new Function (and so without unsafe-eval in a CSP).
    loadModule?(js: string): Promise<{ story: Story }>;
}

const mimeTypes: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp",
    mp3: "audio/mpeg", ogg: "audio/ogg", oga: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", flac: "audio/flac",
    mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
    pdf: "application/pdf", vtt: "text/vtt",
};

const mimeType = (path: string) => mimeTypes[path.substring(path.lastIndexOf(".") + 1).toLowerCase()] ?? "";

const normalisePath = (path: string) => path.replace(/^(\.\/)+/, "");

async function importFromBlob(js: string): Promise<{ story: Story }> {
    const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
    try {
        return await import(/* @vite-ignore */ url);
    }
    finally {
        URL.revokeObjectURL(url);
    }
}

function errorMessage(error: unknown): PreviewMessage {
    if (error instanceof Error) {
        return { type: "runtimeError", message: error.message, ...(error.stack ? { stack: error.stack } : {}) };
    }
    return { type: "runtimeError", message: String(error) };
}

export function createPreview(options: PreviewOptions) {
    const loadModule = options.loadModule ?? importFromBlob;
    let api: SquiffyApi | undefined;
    // Each load gets a new number, so a slow load that's been replaced doesn't start
    let loadCount = 0;
    const assetUrls = new Map<string, string>();
    const objectUrls: string[] = [];
    // The story's own stylesheets and scripts
    let styles: HTMLStyleElement[] = [];
    let scripts: HTMLScriptElement[] = [];
    // Sets the theme. It's added before any of the story's own stylesheets, so they can override it.
    const themeStyle = document.createElement("style");
    document.head.appendChild(themeStyle);

    const send = (message: PreviewMessage) => {
        try {
            options.send(message);
        }
        catch {
            // e.g. an attribute value that can't be cloned
            if (message.type == "attributeSet") options.send({ ...message, value: String(message.value) });
        }
    };

    // Whether the story's stylesheets set color-scheme themselves: if they do, the story looks the
    // same whichever theme the preview is set to
    function themeIsFixed(): boolean {
        const theme = themeStyle.textContent;
        const schemeFor = (scheme: string) => {
            themeStyle.textContent = `:root { color-scheme: ${scheme}; }`;
            return getComputedStyle(document.documentElement).getPropertyValue("color-scheme");
        };
        const fixed = schemeFor("light") == schemeFor("dark");
        themeStyle.textContent = theme;
        return fixed;
    }

    const resolveAssetUrl = (path: string) => assetUrls.get(normalisePath(path)) ?? path;

    function setAssets(assets: PreviewAssets) {
        for (const url of objectUrls.splice(0)) URL.revokeObjectURL(url);
        assetUrls.clear();
        for (const [path, url] of Object.entries(assets.urls ?? {})) {
            assetUrls.set(normalisePath(path), url);
        }
        for (const [path, data] of Object.entries(assets.files ?? {})) {
            const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mimeType(path) });
            const url = URL.createObjectURL(blob);
            objectUrls.push(url);
            assetUrls.set(normalisePath(path), url);
        }
    }

    // Replaces the story's stylesheets, where the old ones were, so they stay before its scripts
    // (which may add styles of their own). Returns false if they haven't changed.
    function setStyles(css: string[]): boolean {
        if (css.length == styles.length && css.every((text, i) => styles[i].textContent == text)) return false;
        const before = styles[0] ?? scripts[0] ?? null;
        const added = css.map(text => {
            const style = document.createElement("style");
            style.textContent = text;
            document.head.insertBefore(style, before);
            return style;
        });
        for (const style of styles) style.remove();
        styles = added;
        return true;
    }

    async function addStoryFiles(story: PreviewStory) {
        for (const element of [...styles, ...scripts]) element.remove();
        styles = [];
        scripts = [];
        setStyles(story.css ?? []);
        for (const js of story.scripts ?? []) {
            const script = document.createElement("script");
            const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
            await new Promise<void>(resolve => {
                script.onload = script.onerror = () => resolve();
                script.src = url;
                document.head.appendChild(script);
            });
            URL.revokeObjectURL(url);
            scripts.push(script);
        }
    }

    async function load(message: Extract<HostMessage, { type: "load" }>) {
        const thisLoad = ++loadCount;
        api = undefined;
        options.element.innerHTML = "";
        await addStoryFiles(message.story);
        const { story } = await loadModule(message.story.js);
        if (thisLoad != loadCount) return;
        send({ type: "themeFixed", fixed: themeIsFixed() });

        const container = document.createElement("div");
        container.className = "squiffy-preview-story";
        options.element.appendChild(container);

        const newApi = await init({
            element: container,
            story,
            persist: false,
            scroll: "element",
            resolveAssetUrl,
            onSet: (name, value) => {
                if (thisLoad == loadCount && !name.startsWith("_")) send({ type: "attributeSet", name, value });
            },
        });
        newApi.on("canGoBackChanged", e => {
            if (thisLoad == loadCount) send({ type: "canGoBackChanged", canGoBack: e.canGoBack });
        });
        newApi.on("navigated", e => {
            if (thisLoad == loadCount) send({ type: "navigated", ...e });
        });
        api = newApi;
        send({ type: "canGoBackChanged", canGoBack: false });
        await newApi.begin(message.startAt);
        if (thisLoad == loadCount) send({ type: "loaded" });
    }

    async function receive(message: HostMessage) {
        try {
            switch (message.type) {
                case "load":
                    await load(message);
                    break;
                case "update":
                    if (!api) break;
                    // A stylesheet can change whether the story sets its own color-scheme
                    if (message.css && setStyles(message.css)) send({ type: "themeFixed", fixed: themeIsFixed() });
                    api.update((await loadModule(message.js)).story);
                    break;
                case "restart":
                    api?.restart();
                    break;
                case "back":
                    api?.goBack();
                    break;
                case "assets":
                    setAssets(message.assets);
                    break;
                case "theme":
                    themeStyle.textContent = message.theme == "system" ? "" : `:root { color-scheme: ${message.theme}; }`;
                    break;
            }
        }
        catch (error) {
            send(errorMessage(error));
        }
    }

    return { receive };
}

export { errorMessage };

import { describe, expect, test, vi } from "vitest";
import { createPreviewHost, PreviewChannel } from "./preview-host.js";
import { PREVIEW_CHANNEL } from "./preview-protocol.js";

const fakeChannel = () => {
    const sent: unknown[] = [];
    let handler: ((data: unknown) => void) | undefined;
    const channel: PreviewChannel = {
        send: m => sent.push(m),
        onMessage: h => {
            handler = h;
            return () => { handler = undefined; };
        },
    };
    return { channel, sent, receive: (data: unknown) => handler?.(data) };
};

describe("preview host", () => {
    test("queues messages until the page is ready", async () => {
        const { channel, sent, receive } = fakeChannel();
        const host = createPreviewHost(channel);
        host.setAssets({ urls: { "a.png": "https://example.com/a.png" } });
        host.load({ js: "export const story = {};" }, { startAt: { section: "s", passage: "p" } });
        expect(sent).toEqual([]);

        receive({ channel: PREVIEW_CHANNEL, type: "ready" });
        await host.ready;
        expect(sent).toEqual([
            { channel: PREVIEW_CHANNEL, type: "assets", assets: { urls: { "a.png": "https://example.com/a.png" } } },
            { channel: PREVIEW_CHANNEL, type: "load", story: { js: "export const story = {};" }, startAt: { section: "s", passage: "p" } },
        ]);

        host.update("x");
        host.update("y", ["body { color: red; }"]);
        host.restart();
        host.back();
        expect(sent.slice(2)).toEqual([
            { channel: PREVIEW_CHANNEL, type: "update", js: "x" },
            { channel: PREVIEW_CHANNEL, type: "update", js: "y", css: ["body { color: red; }"] },
            { channel: PREVIEW_CHANNEL, type: "restart" },
            { channel: PREVIEW_CHANNEL, type: "back" },
        ]);
    });

    test("sends the theme when the page is ready, and again if it reloads", () => {
        const { channel, sent, receive } = fakeChannel();
        const host = createPreviewHost(channel);
        host.setTheme("light");
        host.setTheme("dark");
        expect(sent).toEqual([]);

        receive({ channel: PREVIEW_CHANNEL, type: "ready" });
        expect(sent).toEqual([{ channel: PREVIEW_CHANNEL, type: "theme", theme: "dark" }]);

        host.setTheme("system");
        expect(sent.slice(1)).toEqual([{ channel: PREVIEW_CHANNEL, type: "theme", theme: "system" }]);

        receive({ channel: PREVIEW_CHANNEL, type: "ready" });
        expect(sent.slice(2)).toEqual([{ channel: PREVIEW_CHANNEL, type: "theme", theme: "system" }]);
    });

    test("sends mute when the page is ready, and again if it reloads (#444)", () => {
        const { channel, sent, receive } = fakeChannel();
        const host = createPreviewHost(channel, { onUsesSound: vi.fn() });
        host.setMuted(true);
        expect(sent).toEqual([]);

        receive({ channel: PREVIEW_CHANNEL, type: "ready" });
        expect(sent).toEqual([{ channel: PREVIEW_CHANNEL, type: "muted", muted: true }]);

        host.setMuted(false);
        receive({ channel: PREVIEW_CHANNEL, type: "ready" });
        expect(sent.slice(1)).toEqual([{ channel: PREVIEW_CHANNEL, type: "muted", muted: false }]);
    });

    test("tells the host whether the story uses sound (#444)", () => {
        const { channel, receive } = fakeChannel();
        const onUsesSound = vi.fn();
        createPreviewHost(channel, { onUsesSound });
        receive({ channel: PREVIEW_CHANNEL, type: "usesSound", usesSound: true });
        expect(onUsesSound).toHaveBeenCalledWith(true);
    });

    test("reloads the page before loading a story after one with scripts, sending the assets again (#528)", () => {
        const { channel, sent, receive } = fakeChannel();
        const onReady = vi.fn();
        const host = createPreviewHost(channel, { onReady });
        receive({ channel: PREVIEW_CHANNEL, type: "ready" });
        expect(onReady).toHaveBeenCalledOnce();
        const assets = { urls: { "a.png": "https://example.com/a.png" } };
        host.setAssets(assets);
        host.load({ js: "one", scripts: ["document.addEventListener('squiffy:ready', () => {});"] });
        sent.length = 0;

        // Its scripts could have left things behind, so the page reloads first
        host.setAssets(assets);
        host.load({ js: "two" });
        expect(sent).toEqual([
            { channel: PREVIEW_CHANNEL, type: "assets", assets },
            { channel: PREVIEW_CHANNEL, type: "reload" },
        ]);
        sent.length = 0;
        receive({ channel: PREVIEW_CHANNEL, type: "ready" });
        expect(sent).toEqual([
            { channel: PREVIEW_CHANNEL, type: "assets", assets },
            { channel: PREVIEW_CHANNEL, type: "load", story: { js: "two" } },
        ]);
        // The host asked for it, so it isn't a reload that lost the story
        expect(onReady).toHaveBeenCalledOnce();

        // That story had no scripts, so the next one loads without a reload
        sent.length = 0;
        host.load({ js: "three" });
        expect(sent).toEqual([{ channel: PREVIEW_CHANNEL, type: "load", story: { js: "three" } }]);
    });

    test("a page that reloads by itself is new, so the next story doesn't reload it (#528)", () => {
        const { channel, sent, receive } = fakeChannel();
        const host = createPreviewHost(channel);
        receive({ channel: PREVIEW_CHANNEL, type: "ready" });
        host.load({ js: "one", scripts: ["x"] });
        receive({ channel: PREVIEW_CHANNEL, type: "ready" });
        sent.length = 0;
        host.load({ js: "two" });
        expect(sent).toEqual([{ channel: PREVIEW_CHANNEL, type: "load", story: { js: "two" } }]);
    });

    test("only the last of the loads sent before the page is ready is sent", () => {
        const { channel, sent, receive } = fakeChannel();
        const host = createPreviewHost(channel);
        host.load({ js: "one", scripts: ["x"] });
        host.load({ js: "two" });
        receive({ channel: PREVIEW_CHANNEL, type: "ready" });
        expect(sent).toEqual([{ channel: PREVIEW_CHANNEL, type: "load", story: { js: "two" } }]);
    });

    test("passes messages from the page to handlers, ignoring anything else", () => {
        const { channel, receive } = fakeChannel();
        const handlers = {
            onReady: vi.fn(), onLoaded: vi.fn(), onAttributeSet: vi.fn(), onCanGoBackChanged: vi.fn(),
            onNavigated: vi.fn(), onThemeFixed: vi.fn(), onRuntimeError: vi.fn(),
        };
        const host = createPreviewHost(channel, handlers);
        receive({ type: "navigated", section: "not ours" });
        receive("hello");
        receive(null);
        for (const message of [
            { type: "ready" },
            { type: "loaded" },
            { type: "attributeSet", name: "score", value: 2 },
            { type: "canGoBackChanged", canGoBack: true },
            { type: "navigated", section: "s", passage: "p" },
            { type: "themeFixed", fixed: true },
            { type: "runtimeError", message: "oops", stack: "at x" },
        ]) {
            receive({ channel: PREVIEW_CHANNEL, ...message });
        }
        expect(handlers.onReady).toHaveBeenCalledOnce();
        expect(handlers.onLoaded).toHaveBeenCalledOnce();
        expect(handlers.onAttributeSet).toHaveBeenCalledWith("score", 2);
        expect(handlers.onCanGoBackChanged).toHaveBeenCalledWith(true);
        expect(handlers.onNavigated).toHaveBeenCalledOnce();
        expect(handlers.onNavigated).toHaveBeenCalledWith("s", "p");
        expect(handlers.onThemeFixed).toHaveBeenCalledWith(true);
        expect(handlers.onRuntimeError).toHaveBeenCalledWith("oops", "at x");

        host.dispose();
        receive({ channel: PREVIEW_CHANNEL, type: "loaded" });
        expect(handlers.onLoaded).toHaveBeenCalledOnce();
    });
});

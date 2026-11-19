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
        host.restart();
        host.back();
        expect(sent.slice(2)).toEqual([
            { channel: PREVIEW_CHANNEL, type: "update", js: "x" },
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

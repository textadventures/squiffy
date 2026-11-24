import { afterEach, describe, expect, test, vi } from "vitest";
import { playMessage, readyMessage } from "@textadventures/squiffy-player/play-protocol";
import { connectPlayTab, playPageUrl } from "./play-in-tab.js";

const PLAYER = "https://squiffystories.com";

// A window that a test can send messages to, as if from another
function fakeHost() {
    let listener: ((event: MessageEvent) => void) | undefined;
    return {
        addEventListener: (_type: string, l: (event: MessageEvent) => void) => { listener = l; },
        removeEventListener: () => { listener = undefined; },
        send: (data: unknown, source: unknown, origin: string) => listener?.({ data, source, origin } as MessageEvent),
        get listening() { return !!listener; },
    };
}

function fakeTab() {
    return { postMessage: vi.fn(), close: vi.fn(), closed: false } as unknown as Window & { postMessage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("connectPlayTab", () => {
    test("sends the story to the player's origin once the play page is ready", async () => {
        const host = fakeHost();
        const tab = fakeTab();
        const playTab = connectPlayTab(tab, host as unknown as Window, PLAYER);
        const playing = playTab.play("<p>Hello</p>");
        expect(tab.postMessage).not.toHaveBeenCalled();
        host.send(readyMessage(), tab, PLAYER);
        await playing;
        expect(tab.postMessage).toHaveBeenCalledWith(playMessage("<p>Hello</p>"), PLAYER);
        expect(host.listening).toBe(false);
    });

    test("the play page can be ready before the story is", async () => {
        const host = fakeHost();
        const tab = fakeTab();
        const playTab = connectPlayTab(tab, host as unknown as Window, PLAYER);
        host.send(readyMessage(), tab, PLAYER);
        await playTab.play("<p>Hello</p>");
        expect(tab.postMessage).toHaveBeenCalledOnce();
    });

    test("only the tab, from the player's origin, can say it's ready", async () => {
        vi.useFakeTimers();
        const host = fakeHost();
        const tab = fakeTab();
        const playTab = connectPlayTab(tab, host as unknown as Window, PLAYER, 1000);
        const playing = playTab.play("<p>Secret</p>");
        const failed = expect(playing).rejects.toThrow("its tab didn't load");
        host.send(readyMessage(), fakeTab(), PLAYER);
        host.send(readyMessage(), tab, "https://evil.example.com");
        host.send({ type: "ready" }, tab, PLAYER);
        await vi.advanceTimersByTimeAsync(1000);
        await failed;
        expect(tab.postMessage).not.toHaveBeenCalled();
    });

    test("close stops listening and closes the tab", () => {
        const host = fakeHost();
        const tab = fakeTab();
        connectPlayTab(tab, host as unknown as Window, PLAYER).close();
        expect(host.listening).toBe(false);
        expect(tab.close).toHaveBeenCalled();
    });
});

test("the play page is in the player's folder for the major version", () => {
    expect(playPageUrl("7.2.0-beta.1")).toMatch(/\/v7\/play$/);
});

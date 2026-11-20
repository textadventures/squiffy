// Music and sound effects (#444), with a fake Audio that records what's played
import { expect, test, beforeEach, afterEach, vi } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";

class FakeAudio {
    static all: FakeAudio[] = [];
    // Whether play() is refused, as a browser does before the player has clicked anything
    static refuse = false;
    src: string;
    loop = false;
    muted = false;
    volume = 1;
    preload = "";
    paused = true;
    listeners: Record<string, (() => void)[]> = {};

    constructor(src = "") {
        this.src = src;
        FakeAudio.all.push(this);
    }

    play() {
        if (FakeAudio.refuse) {
            const error = new Error("Not allowed");
            error.name = "NotAllowedError";
            return Promise.reject(error);
        }
        this.paused = false;
        return Promise.resolve();
    }

    pause() {
        this.paused = true;
    }

    addEventListener(name: string, listener: () => void) {
        (this.listeners[name] ??= []).push(listener);
    }

    end() {
        this.paused = true;
        this.listeners.ended?.forEach(l => l());
    }
}

// What's playing: music loops, sounds don't
const playing = () => FakeAudio.all.filter(a => !a.paused);
const music = () => playing().filter(a => a.loop).map(a => a.src);
const sounds = () => playing().filter(a => !a.loop).map(a => a.src);

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body><div id=\"squiffy\"></div></body></html>");
    FakeAudio.all = [];
    FakeAudio.refuse = false;
    vi.stubGlobal("Audio", FakeAudio);
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    cleanup();
});

const start = async (script: string, options: { persist?: boolean; resolveAssetUrl?: (path: string) => string } = {}) => {
    const result = await squiffyCompile({ script });
    if (!result.success) throw new Error("Compile failed");
    const story = {
        ...result.output.story,
        js: result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n"))) as any,
    };
    const element = document.getElementById("squiffy")!;
    const api = await init({ element, story, persist: options.persist ?? false, storyId: "test", ...options });
    await api.begin();
    return { api, element };
};

const click = async (element: HTMLElement, text: string) => {
    const link = [...element.querySelectorAll<HTMLElement>("a.squiffy-link")]
        .find(l => l.textContent == text && !l.classList.contains("disabled"));
    if (!link) throw new Error(`No link "${text}"`);
    link.click();
    await vi.runAllTimersAsync();
};

const story = `
[[forest]]:
@music forest.mp3
The forest. [[Go to the cave]](cave), [[stay in the forest]](forest2)

[[forest2]]:
@music forest.mp3
Still the forest. [[Go to the cave]](cave)

[[cave]]:
@music cave.mp3
@sound drip.mp3
The cave. [[Leave]](outside)

[[outside]]:
@music stop
Outside.
`;

test("@music plays music, which carries on in a section with the same music", async () => {
    const { element } = await start(story);
    expect(music()).toEqual(["forest.mp3"]);
    const forest = playing()[0];

    await click(element, "stay in the forest");
    expect(music()).toEqual(["forest.mp3"]);
    // The same one, not started again
    expect(playing()[0]).toBe(forest);
});

test("@music changes the music, fading out the old one, and @music stop stops it", async () => {
    const { element } = await start(story);
    const forest = playing()[0];

    await click(element, "Go to the cave");
    expect(forest.paused).toBe(true);
    expect(forest.volume).toBe(0);
    expect(music()).toEqual(["cave.mp3"]);
    expect(playing().find(a => a.loop)!.volume).toBe(1);

    await click(element, "Leave");
    expect(music()).toEqual([]);
});

test("@sound plays a sound once", async () => {
    const { element } = await start(story);
    await click(element, "Go to the cave");
    expect(sounds()).toEqual(["drip.mp3"]);
    const drip = playing().find(a => a.src == "drip.mp3")!;
    expect(drip.loop).toBe(false);
});

test("The music is the _music attribute, so going back puts the music back", async () => {
    const { api, element } = await start(story);
    await click(element, "Go to the cave");
    expect(api.get("_music")).toBe("cave.mp3");

    api.goBack();
    await vi.runAllTimersAsync();
    expect(api.get("_music")).toBe("forest.mp3");
    expect(music()).toEqual(["forest.mp3"]);
});

test("Loading a saved game plays its music", async () => {
    const { api, element } = await start(story);
    const save = api.getSave();
    await click(element, "Go to the cave");
    await click(element, "Leave");
    expect(music()).toEqual([]);

    await api.loadSave(save);
    await vi.runAllTimersAsync();
    expect(music()).toEqual(["forest.mp3"]);
});

test("A story carried on from where it was left plays its music", async () => {
    const first = await start(story, { persist: true });
    await click(first.element, "Go to the cave");
    first.api.dispose();
    first.element.innerHTML = "";
    FakeAudio.all = [];

    await start(story, { persist: true });
    expect(music()).toEqual(["cave.mp3"]);
});

test("{{music}}, {{stopmusic}} and {{sound}} in the text", async () => {
    const { element } = await start(`
Start. {{music "theme.mp3" fade=0}}{{sound "bell.mp3" volume=0.5}} [[Next]](next)

[[next]]:
{{stopmusic fade=0}}Quiet.
`);
    expect(music()).toEqual(["theme.mp3"]);
    expect(playing().find(a => a.src == "theme.mp3")!.volume).toBe(1);
    expect(playing().find(a => a.src == "bell.mp3")!.volume).toBe(0.5);

    await click(element, "Next");
    expect(music()).toEqual([]);
});

test("@sound stop and {{stopsounds}} stop the sounds playing once, and the music carries on", async () => {
    const { element } = await start(`
@music theme.mp3
{{sound "bell.mp3"}}{{sound "rain.mp3"}}Start. [[Next]](next)

[[next]]:
@sound stop
@sound door.mp3
Next. [[Again]](again)

[[again]]:
{{stopsounds}}Quiet.
`);
    expect(sounds()).toEqual(["bell.mp3", "rain.mp3"]);

    await click(element, "Next");
    // Stopped before the section's own sound plays
    expect(sounds()).toEqual(["door.mp3"]);
    expect(music()).toEqual(["theme.mp3"]);

    await click(element, "Again");
    expect(sounds()).toEqual([]);
    expect(music()).toEqual(["theme.mp3"]);
});

test("{{music}} and {{sound}} on their own are still attributes", async () => {
    const { element } = await start(`
@set music = jazz
@set sound = loud
I like {{music}}, {{sound}}.
`);
    expect(element.textContent).toContain("I like jazz, loud.");
    expect(FakeAudio.all.filter(a => a.src == "jazz" || a.src == "loud")).toEqual([]);
});

test("Music refused before the player has done anything starts when they click", async () => {
    FakeAudio.refuse = true;
    await start(story);
    await vi.runAllTimersAsync();
    expect(music()).toEqual([]);

    FakeAudio.refuse = false;
    document.dispatchEvent(new window.Event("pointerdown"));
    await vi.runAllTimersAsync();
    expect(music()).toEqual(["forest.mp3"]);
});

test("Muting mutes what's playing and what plays next, and is remembered for the story", async () => {
    const { api, element } = await start(story, { persist: true });
    expect(api.isMuted()).toBe(false);
    api.setMuted(true);
    expect(playing()[0].muted).toBe(true);

    await click(element, "Go to the cave");
    expect(playing().every(a => a.muted)).toBe(true);
    expect(localStorage.getItem("squiffy-muted:test")).toBe("true");

    // Restarting doesn't forget it
    api.restart();
    expect(api.isMuted()).toBe(true);
    expect(localStorage.getItem("squiffy-muted:test")).toBe("true");
});

test("Files are preloaded, through resolveAssetUrl", async () => {
    const { api } = await start(story, { resolveAssetUrl: path => "blob:" + path });
    const preloaded = FakeAudio.all.filter(a => a.preload == "auto").map(a => a.src).sort();
    expect(preloaded).toEqual(["blob:cave.mp3", "blob:drip.mp3", "blob:forest.mp3"]);
    expect(music()).toEqual(["blob:forest.mp3"]);
    expect(api.usesSound()).toBe(true);
});

test("A story with no sound doesn't use sound", async () => {
    const { api } = await start("Hello.");
    expect(api.usesSound()).toBe(false);
    expect(FakeAudio.all).toEqual([]);
});

test("dispose() stops everything", async () => {
    const { api } = await start(story);
    api.dispose();
    expect(playing()).toEqual([]);
});

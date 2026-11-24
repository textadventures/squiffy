import { expect, test, beforeEach, afterEach } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";
import type { SquiffyInitOptions } from "./types.js";

// Where the player's progress is kept in localStorage (#642)

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body><div id=\"squiffy\"></div></body></html>", { url: "https://example.com/games/story/" });
});

afterEach(() => {
    localStorage.clear();
    cleanup();
});

const script = `[[start]]:
@set score = 1
Hello. [[Next]](next)

[[next]]:
@set score = 2
The end.`;

const start = async (options: Partial<SquiffyInitOptions> = {}, projectId?: string) => {
    const element = document.getElementById("squiffy")!;
    element.innerHTML = "";
    const result = await squiffyCompile({ script, projectId, persistent: ["endings"] });
    if (!result.success) throw new Error("Compile failed");
    const js = result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n")));
    const api = await init({ element, story: { js: js as any, ...result.output.story }, persist: true, scroll: "none", ...options });
    await api.begin();
    return api;
};

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test("Restarting a story leaves other stories' progress alone", async () => {
    localStorage.setItem("/story2-score", "5");
    localStorage.setItem("/other/-score", "6");
    const api = await start({ storyId: "/" });
    expect(localStorage.getItem("/-score")).toBe("1");
    api.restart();
    await settle();
    expect(localStorage.getItem("/other/-score")).toBe("6");
    expect(localStorage.getItem("/story2-score")).toBe("5");
});

test("A story with an id keeps the player's progress under it, wherever it is", async () => {
    const api = await start({}, "0b7c6d9e-story");
    expect(localStorage.getItem("0b7c6d9e-story-score")).toBe("1");
    expect(localStorage.getItem("/games/story/-score")).toBeNull();
    api.dispose();
});

test("A story without an id keeps it under the page's address", async () => {
    await start();
    expect(localStorage.getItem("/games/story/-score")).toBe("1");
});

test("Progress kept under the page's address is moved to the story's id", async () => {
    localStorage.setItem("/games/story/-score", "2");
    localStorage.setItem("/games/story/-_section", JSON.stringify("next"));
    localStorage.setItem("/games/story/-_output", JSON.stringify("<div class=\"squiffy-output-section\" data-section=\"next\"><div class=\"squiffy-output-block\">The end.</div></div>"));
    localStorage.setItem("squiffy-persistent:/games/story/", JSON.stringify({ endings: { a: true } }));
    localStorage.setItem("squiffy-muted:/games/story/", "true");
    const api = await start({}, "0b7c6d9e-story");
    expect(api.get("score")).toBe(2);
    expect(api.getPersistent()).toEqual({ endings: { a: true } });
    expect(api.isMuted()).toBe(true);
    expect(localStorage.getItem("/games/story/-score")).toBeNull();
    expect(localStorage.getItem("squiffy-persistent:/games/story/")).toBeNull();
});

test("Progress already under the story's id isn't replaced by what's under the address", async () => {
    localStorage.setItem("0b7c6d9e-story-score", "2");
    localStorage.setItem("0b7c6d9e-story-_section", JSON.stringify("next"));
    localStorage.setItem("0b7c6d9e-story-_output", JSON.stringify("<div class=\"squiffy-output-section\" data-section=\"next\"><div class=\"squiffy-output-block\">The end.</div></div>"));
    localStorage.setItem("/games/story/-score", "9");
    const api = await start({}, "0b7c6d9e-story");
    expect(api.get("score")).toBe(2);
});

// {{youtube}}: embedded on a page served over http(s), and a link with the video's
// picture elsewhere, such as the sandboxed preview
import { expect, test, describe, afterEach, vi } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";
import { canEmbedVideos, embedUrl, parseStart, parseYouTube, thumbnailUrl, watchUrl } from "./videos.js";

let cleanup: (() => void) | undefined;

afterEach(() => {
    vi.restoreAllMocks();
    cleanup?.();
    cleanup = undefined;
});

// A published page, or by default, one with an opaque origin, as the preview's sandboxed frame has
// (jsdom's own opaque origins have no localStorage, which the runtime needs)
const start = async (script: string, options: { published?: boolean; strings?: Record<string, string> } = {}) => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body><div id=\"squiffy\"></div></body></html>", { url: "https://example.com/story/" });
    if (!options.published) Object.defineProperty(window, "origin", { value: "null", configurable: true });
    const result = await squiffyCompile({ script });
    if (!result.success) throw new Error("Compile failed");
    const story = {
        ...result.output.story,
        js: result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n"))) as any,
    };
    const element = document.getElementById("squiffy")!;
    const api = await init({ element, story, persist: false, storyId: "test", scroll: "none", strings: options.strings });
    await api.begin();
    return { api, element };
};

describe("finding the video", () => {
    test("YouTube, from its ID or any of its addresses", () => {
        const id = "aqz-KE-bpKQ";
        for (const value of [
            id, ` ${id} `,
            `https://www.youtube.com/watch?v=${id}`, `youtube.com/watch?v=${id}&list=x`, `https://m.youtube.com/watch?v=${id}`,
            `https://youtu.be/${id}`, `https://youtu.be/${id}?si=abc`, `https://www.youtube.com/embed/${id}`,
            `https://www.youtube-nocookie.com/embed/${id}`, `https://www.youtube.com/shorts/${id}`, `https://www.youtube.com/live/${id}`,
        ]) {
            expect(parseYouTube(value), value).toEqual({ id });
        }
        expect(parseYouTube(`https://youtu.be/${id}?t=90`)).toEqual({ id, start: 90 });
        expect(parseYouTube(`https://www.youtube.com/watch?v=${id}&t=1m30s`)).toEqual({ id, start: 90 });
        expect(parseYouTube(`https://www.youtube.com/embed/${id}?start=5`)).toEqual({ id, start: 5 });
    });

    test("not YouTube", () => {
        for (const value of ["", "short", "https://example.com/watch?v=aqz-KE-bpKQ", "https://youtube.com/watch?v=bad", "https://www.youtube.com/@channel",
            "javascript:alert(1)", "aqz-KE-bpKQ\"><script>"]) {
            expect(parseYouTube(value), value).toBeUndefined();
        }
    });

    test("where it starts", () => {
        expect(parseStart(90)).toBe(90);
        expect(parseStart("90")).toBe(90);
        expect(parseStart("90s")).toBe(90);
        expect(parseStart("1:30")).toBe(90);
        expect(parseStart("1:02:03")).toBe(3723);
        expect(parseStart("1h2m3s")).toBe(3723);
        expect(parseStart("2m")).toBe(120);
        for (const value of [0, -5, "", "soon", undefined, NaN]) expect(parseStart(value), String(value)).toBeUndefined();
    });

    test("its addresses", () => {
        const youtube = { id: "aqz-KE-bpKQ", start: 90 };
        expect(watchUrl(youtube)).toBe("https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=90s");
        expect(embedUrl(youtube)).toBe("https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?start=90");
        expect(thumbnailUrl(youtube)).toBe("https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg");
    });
});

describe("whether it can be embedded", () => {
    test("only on a page served over http(s), not in a sandboxed frame", () => {
        const page = (protocol: string, origin: string) => ({ location: { protocol }, origin }) as unknown as Window;
        expect(canEmbedVideos(page("https:", "https://example.com"))).toBe(true);
        expect(canEmbedVideos(page("http:", "http://127.0.0.1:8282"))).toBe(true);
        // A srcdoc frame sandboxed without allow-same-origin
        expect(canEmbedVideos(page("about:", "null"))).toBe(false);
        expect(canEmbedVideos(page("https:", "null"))).toBe(false);
        expect(canEmbedVideos(page("file:", "null"))).toBe(false);
        expect(canEmbedVideos(page("vscode-webview:", "vscode-webview://abc"))).toBe(false);
        expect(canEmbedVideos(page("story:", "story://local"))).toBe(false);
    });
});

describe("the helpers", () => {
    test("embed the player on a published page", async () => {
        const { element } = await start("Watch this. {{youtube \"https://youtu.be/aqz-KE-bpKQ\" start=\"1:30\" title=\"Big Buck Bunny\"}} And {{youtube \"aqz-KE-bpKQ\"}}", { published: true });
        const frames = element.querySelectorAll<HTMLIFrameElement>(".squiffy-video iframe");
        expect(frames).toHaveLength(2);
        expect(frames[0].src).toBe("https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?start=90");
        expect(frames[0].title).toBe("Big Buck Bunny");
        expect(frames[0].hasAttribute("allowfullscreen")).toBe(true);
        expect(frames[1].src).toBe("https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ");
        expect(frames[1].title).toBe("YouTube video");
        expect(element.querySelector("a.squiffy-video-link")).toBeNull();
    });

    test("link to the video where it can't be embedded, such as the preview", async () => {
        const { element } = await start("{{youtube \"aqz-KE-bpKQ\" title=\"Big Buck Bunny\"}}\n\n{{youtube \"https://youtu.be/aqz-KE-bpKQ?t=30\"}}");
        expect(element.querySelector("iframe")).toBeNull();
        const [youtube, untitled] = element.querySelectorAll<HTMLAnchorElement>("a.squiffy-video-link");
        expect(youtube.href).toBe("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
        expect(youtube.target).toBe("_blank");
        expect(youtube.rel).toBe("noopener noreferrer");
        expect(youtube.querySelector("img")!.src).toBe("https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg");
        expect(youtube.textContent).toBe("Big Buck Bunny Watch on YouTube");
        expect(untitled.href).toBe("https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30s");
        expect(untitled.textContent).toBe("Watch on YouTube");
        // It isn't a story link, so it stays clickable after the reader moves on
        expect(youtube.classList.contains("squiffy-link")).toBe(false);
    });

    test("the link's text in another language", async () => {
        const { element } = await start("{{youtube \"aqz-KE-bpKQ\"}}", { strings: { watchOnYouTube: "Regarder sur YouTube" } });
        expect(element.querySelector(".squiffy-video-watch")!.textContent).toBe("Regarder sur YouTube");
    });

    test("show nothing for something that isn't a video", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { element } = await start("Before{{youtube \"https://example.com/\"}}{{youtube 42}}After");
        expect(element.textContent).toContain("BeforeAfter");
        expect(warn).toHaveBeenCalledWith("Not a YouTube video: https://example.com/");
        expect(warn).toHaveBeenCalledWith("Not a YouTube video: 42");
    });

    test("escape the title", async () => {
        const { element } = await start("{{youtube \"aqz-KE-bpKQ\" title=\"<b>\\\"Hi\\\"</b>\"}}");
        expect(element.querySelector("b")).toBeNull();
        expect(element.querySelector(".squiffy-video-title")!.textContent).toBe("<b>\"Hi\"</b>");
    });
});

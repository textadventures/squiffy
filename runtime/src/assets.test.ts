import { expect, test, beforeEach, afterEach, vi } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";
import { SquiffyInitOptions } from "./types.js";

// anime.js captures the global document when it's imported, which is before each test
// sets up jsdom, so it can't run here. Replace it with a stub that completes immediately.
vi.mock("animejs", () => ({
    animate: (_targets: unknown, params: { onComplete?: () => void }) => {
        setTimeout(() => params.onComplete?.());
    },
    stagger: () => 0,
    text: {
        split: (el: HTMLElement) => ({ chars: [el], words: [el], lines: [el] }),
    },
}));

const html = `
<!DOCTYPE html>
<html>
<body>
    <div id="squiffy"></div>
</body>
</html>
`;

const compile = async (script: string) => {
    const compileResult = await squiffyCompile({ script });
    if (!compileResult.success) {
        throw new Error("Compile failed");
    }
    const js = compileResult.output.js.map(jsLines => new Function("squiffy", "get", "set", jsLines.join("\n")));
    return { js: js as any, ...compileResult.output.story };
};

const resolveAssetUrl = (path: string) => `blob:test/${path}`;

const initScript = async (script: string, options: Partial<SquiffyInitOptions> = {}) => {
    const element = document.getElementById("squiffy")!;
    const squiffyApi = await init({
        element,
        story: await compile(script),
        persist: false,
        ...options,
    });
    await squiffyApi.begin();
    return { squiffyApi, element };
};

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom(html, { url: "http://localhost/" });
});

afterEach(() => {
    localStorage.clear();
    cleanup();
});

test("Asset paths are unchanged without resolveAssetUrl", async () => {
    const { element } = await initScript(`![A cat](cat.png)

<img src="dog.png">`);
    const images = element.querySelectorAll("img");
    expect(images[0].getAttribute("src")).toBe("cat.png");
    expect(images[1].getAttribute("src")).toBe("dog.png");
    expect(element.innerHTML).not.toContain("data-squiffy-asset");
});

test("resolveAssetUrl is applied to img src from Markdown and HTML", async () => {
    const { element } = await initScript(`![A cat](cat.png)

<img src="images/dog.png">`, { resolveAssetUrl });
    const images = element.querySelectorAll("img");
    expect(images[0].getAttribute("src")).toBe("blob:test/cat.png");
    expect(images[0].getAttribute("alt")).toBe("A cat");
    expect(images[1].getAttribute("src")).toBe("blob:test/images/dog.png");
});

test("resolveAssetUrl is applied to audio, video, source, poster and srcset", async () => {
    const { element } = await initScript(`<audio src="music.mp3"></audio>
<video poster="poster.jpg"><source src="clip.webm" type="video/webm"></video>
<img srcset="small.png 1x, large.png 2x, https://example.com/x.png 3x">`, { resolveAssetUrl });
    expect(element.querySelector("audio")!.getAttribute("src")).toBe("blob:test/music.mp3");
    expect(element.querySelector("video")!.getAttribute("poster")).toBe("blob:test/poster.jpg");
    expect(element.querySelector("source")!.getAttribute("src")).toBe("blob:test/clip.webm");
    expect(element.querySelector("img")!.getAttribute("srcset"))
        .toBe("blob:test/small.png 1x, blob:test/large.png 2x, https://example.com/x.png 3x");
});

test("resolveAssetUrl is applied to url() in inline styles", async () => {
    const { element } = await initScript("<div id=\"bg\" style=\"background-image: url('bg.png'); color: red\"></div>", { resolveAssetUrl });
    const style = element.querySelector("#bg")!.getAttribute("style");
    expect(style).toBe("background-image: url(\"blob:test/bg.png\"); color: red");
});

test("Absolute URLs are not passed to resolveAssetUrl", async () => {
    const paths: string[] = [];
    const { element } = await initScript(`<img src="http://example.com/a.png">
<img src="https://example.com/b.png">
<img src="data:image/png;base64,AAAA">
<img src="blob:http://localhost/1234">
<img src="//example.com/c.png">
<img src="local.png">`, {
        resolveAssetUrl: path => {
            paths.push(path);
            return resolveAssetUrl(path);
        }
    });
    expect(paths).toEqual(["local.png"]);
    const srcs = [...element.querySelectorAll("img")].map(img => img.getAttribute("src"));
    expect(srcs).toEqual([
        "http://example.com/a.png",
        "https://example.com/b.png",
        "data:image/png;base64,AAAA",
        "blob:http://localhost/1234",
        "//example.com/c.png",
        "blob:test/local.png",
    ]);
});

test("Percent-encoded paths are decoded before being passed to resolveAssetUrl", async () => {
    const { element } = await initScript("<img src=\"my%20cat.png\">", { resolveAssetUrl });
    expect(element.querySelector("img")!.getAttribute("src")).toBe("blob:test/my cat.png");
});

test("Links are not passed to resolveAssetUrl", async () => {
    const { element } = await initScript(`<a href="page.html">link</a> [[next]]

[[next]]:
Next`, { resolveAssetUrl });
    expect(element.querySelector("a[href]")!.getAttribute("href")).toBe("page.html");
});

test("resolveAssetUrl is applied to passages", async () => {
    const { squiffyApi, element } = await initScript(`Click [here].

[here]:
![A cat](cat.png)`, { resolveAssetUrl });
    const link = [...element.querySelectorAll<HTMLElement>("a.link-passage")].find(a => a.textContent === "here")!;
    await squiffyApi.clickLink(link);
    expect(element.querySelector("img")!.getAttribute("src")).toBe("blob:test/cat.png");
});

test("resolveAssetUrl is applied when the story is updated", async () => {
    const { squiffyApi, element } = await initScript("Hello", { resolveAssetUrl });
    squiffyApi.update(await compile("Hello ![A cat](cat.png)"));
    expect(element.querySelector("img")!.getAttribute("src")).toBe("blob:test/cat.png");
});

test("Saved output is resolved again when it's loaded", async () => {
    const script = "![A cat](cat.png)";
    const story = await compile(script);

    // First run, e.g. in a previous editor session, where cat.png was a different blob URL
    let element = document.getElementById("squiffy")!;
    let api = await init({ element, story, persist: true, storyId: "assets-test", resolveAssetUrl: p => `blob:old/${p}` });
    await api.begin();
    expect(element.querySelector("img")!.getAttribute("src")).toBe("blob:old/cat.png");

    // Load the saved output into a fresh element
    element.innerHTML = "";
    element = document.getElementById("squiffy")!;
    api = await init({ element, story, persist: true, storyId: "assets-test", resolveAssetUrl: p => `blob:new/${p}` });
    await api.begin();
    expect(element.querySelector("img")!.getAttribute("src")).toBe("blob:new/cat.png");
});

test("Asset paths in animate blocks are unchanged without resolveAssetUrl", async () => {
    const { element } = await initScript("{{#animate \"typewriter\"}}![A cat](cat.png){{/animate}}");
    await vi.waitFor(() => expect(element.querySelector(".squiffy-animate")).toBeNull());
    expect(element.querySelector("img")!.getAttribute("src")).toBe("cat.png");
    expect(element.innerHTML).not.toContain("data-squiffy-asset");
});

test("resolveAssetUrl is applied to inline animate content", async () => {
    const { element } = await initScript("{{#animate \"typewriter\"}}![A cat](cat.png){{/animate}}", { resolveAssetUrl });
    await vi.waitFor(() => expect(element.querySelector(".squiffy-animate")).toBeNull());
    // The content is restored after the animation completes, so check it's still resolved
    expect(element.querySelector("img")!.getAttribute("src")).toBe("blob:test/cat.png");
});

test("resolveAssetUrl is applied to block animate content", async () => {
    const { element } = await initScript(`{{#animate "typewriter"}}
![A cat](cat.png)

<img src="dog.png">
{{/animate}}`, { resolveAssetUrl });
    await vi.waitFor(() => expect(element.querySelector(".squiffy-animate")).toBeNull());
    const srcs = [...element.querySelectorAll("img")].map(img => img.getAttribute("src"));
    expect(srcs).toEqual(["blob:test/cat.png", "blob:test/dog.png"]);
});

test("resolveAssetUrl is applied to animate content waiting for a link trigger", async () => {
    const { element } = await initScript(`{{#animate "typewriter" trigger="link"}}![A cat](cat.png) [next]{{/animate}}

[next]:
Next`, { resolveAssetUrl });
    expect(element.querySelector(".squiffy-animate img")!.getAttribute("src")).toBe("blob:test/cat.png");
});

test("Saved animate content is resolved again when it's loaded", async () => {
    const script = `{{#animate "typewriter" trigger="link"}}![A cat](cat.png) [next]{{/animate}}

{{#animate "typewriter"}}![A dog](dog.png){{/animate}}

[next]:
Next`;
    const story = await compile(script);
    const srcs = (element: HTMLElement) => [...element.querySelectorAll("img")].map(img => img.getAttribute("src"));

    let element = document.getElementById("squiffy")!;
    let api = await init({ element, story, persist: true, storyId: "assets-animate-test", resolveAssetUrl: p => `blob:old/${p}` });
    await api.begin();
    await vi.waitFor(() => expect(element.querySelectorAll(".squiffy-animate").length).toBe(1));
    expect(srcs(element)).toEqual(["blob:old/cat.png", "blob:old/dog.png"]);

    // Load the saved output: the pending (link-triggered) animation is rendered again from
    // its stored content, and the completed one is re-resolved with the rest of the output.
    element.innerHTML = "";
    element = document.getElementById("squiffy")!;
    api = await init({ element, story, persist: true, storyId: "assets-animate-test", resolveAssetUrl: p => `blob:new/${p}` });
    await api.begin();
    expect(srcs(element)).toEqual(["blob:new/cat.png", "blob:new/dog.png"]);
});

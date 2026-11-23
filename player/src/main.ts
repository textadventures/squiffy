// The player: plays the story in this page's address (see link.ts). Nothing is fetched and
// nothing is stored: the story is compiled here, and run in a sandboxed frame, as the editor's
// preview is, so its JavaScript can't reach this page, its storage, or another story's.
import { createLanguageService } from "squiffy-compiler/language-service";
import { createPreviewHost, iframeChannel, setUpPreviewFrame, type PreviewHost } from "squiffy-runtime/preview-host";
import { previewHtml } from "squiffy-runtime/preview-html";
import { decodeStory, mainFile, payloadFromFragment, storyFragment, storyPath, type LinkedStory } from "./link.ts";

// Where "Open in editor" goes: the editor makes a new story from the same payload
const EDITOR_URL: string = import.meta.env.VITE_EDITOR_URL || (import.meta.env.DEV ? "http://localhost:5180" : "https://app.squiffystory.com");
const HOME_URL = "https://squiffystory.com";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const title = element("title");
const back = element<HTMLButtonElement>("back");
const restart = element<HTMLButtonElement>("restart");
const edit = element<HTMLAnchorElement>("edit");
const frame = element<HTMLIFrameElement>("story");
const message = element("message");

let preview: PreviewHost | undefined;

function show(heading: string, text: string, detail?: string) {
    frame.hidden = true;
    back.hidden = true;
    restart.hidden = true;
    message.hidden = false;
    message.replaceChildren();
    message.append(Object.assign(document.createElement("h2"), { textContent: heading }));
    message.append(Object.assign(document.createElement("p"), { textContent: text }));
    if (detail) message.append(Object.assign(document.createElement("pre"), { textContent: detail }));
    const about = document.createElement("p");
    about.append("Stories here are made with ", Object.assign(document.createElement("a"), { href: HOME_URL, textContent: "Squiffy" }), ".");
    message.append(about);
}

async function compile(story: LinkedStory) {
    const main = mainFile(story);
    if (!main) return { success: false as const, errors: ["The link has no story file in it."] };
    const service = createLanguageService({
        mainFile: main,
        files: {
            list: async () => Object.keys(story.files).map(path => ({ path })),
            readText: async path => {
                const text = story.files[path];
                if (text === undefined) throw new Error(`${path} isn't in the link`);
                return text;
            },
        },
    });
    const compiled = await service.getPreviewStory();
    if (!compiled.success) return compiled;
    const title = (await service.getDocumentSymbols(main)).find(symbol => symbol.kind === "title")?.name;
    // As on a published page, the story has a Back button unless its squiffy.json says not
    const backButton = (await service.getProjectInfo()).projectFile?.backButton !== false;
    // The story's images, by their paths as the story refers to them
    const assets: Record<string, Uint8Array> = {};
    for (const [path, data] of Object.entries(story.assets ?? {})) {
        const relative = storyPath(main, path);
        if (relative !== null) assets[relative] = data;
    }
    return { ...compiled, title, backButton, assets };
}

async function play() {
    const payload = payloadFromFragment(location.hash);
    title.textContent = "";
    edit.hidden = true;
    document.title = "A Squiffy story";
    if (!payload) {
        show("No story here", "This page plays a story from a link, and this link doesn't have one in it.");
        return;
    }
    const story = decodeStory(payload);
    if (!story) {
        show("This link doesn't work", "The story in it can't be read. Part of the link may have been cut off when it was copied or sent.");
        return;
    }
    edit.href = `${EDITOR_URL}/${storyFragment(payload)}`;
    edit.hidden = false;

    let compiled: Awaited<ReturnType<typeof compile>>;
    try {
        compiled = await compile(story);
    } catch (err) {
        compiled = { success: false, errors: [err instanceof Error ? err.message : String(err)] };
    }
    if (!compiled.success) {
        show("This story has a problem", "It can't be played until its author fixes this. You can open it in the editor to see.", compiled.errors.join("\n"));
        return;
    }
    if (compiled.title) {
        title.textContent = compiled.title;
        document.title = compiled.title;
    }

    if (!preview) {
        setUpPreviewFrame(frame, previewHtml);
        preview = createPreviewHost(iframeChannel(frame), {
            onCanGoBackChanged: canGoBack => { back.disabled = !canGoBack; },
            onRuntimeError: (text, stack) => console.error(text, stack),
        });
        preview.setTheme("system");
    }
    message.hidden = true;
    frame.hidden = false;
    restart.hidden = false;
    back.hidden = !compiled.backButton;
    back.disabled = true;
    preview.setAssets({ files: compiled.assets });
    preview.load({ js: compiled.js, css: compiled.css, scripts: compiled.scripts });
}

back.addEventListener("click", () => preview?.back());
restart.addEventListener("click", () => preview?.restart());
// Another story's link, pasted over this one
window.addEventListener("hashchange", () => void play());
void play();

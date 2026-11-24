// The player: plays the story in this page's address (see link.ts). Nothing is fetched, and
// nothing about the story is stored: it's compiled here, and run in a sandboxed frame, as the
// editor's preview is, so its JavaScript can't reach this page, its storage, or another story's.
// Only the reader's light or dark and mute choices are remembered, for every story.
import { createLanguageService } from "squiffy-compiler/language-service";
import { createPreviewHost, iframeChannel, setUpPreviewFrame, type PreviewHost, type PreviewTheme } from "squiffy-runtime/preview-host";
import { previewHtml } from "squiffy-runtime/preview-html";
import { decodeStory, mainFile, payloadFromFragment, storyFragment, storyPath, type LinkedStory } from "./link.ts";

// Where "Open in editor" goes: the editor makes a new story from the same payload
const EDITOR_URL: string = import.meta.env.VITE_EDITOR_URL || (import.meta.env.DEV ? "http://localhost:5180" : "https://app.squiffystory.com");
const HOME_URL = "https://squiffystory.com";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
// This page's own bar, shown only when there's no story to play, with "Open in editor" for a story
// that has a problem: a playing story has its title and an edit button in its own header, with
// its other buttons
const bar = element("bar");
const edit = element<HTMLAnchorElement>("edit");
const frame = element<HTMLIFrameElement>("story");
const message = element("message");

let preview: PreviewHost | undefined;
// Whether the story's link asks for its "Open in editor" button (see LinkedStory)
let editable = true;

// The reader's choices from the story's own light/dark and mute buttons, kept for every story
const THEME_KEY = "squiffy-player-theme";
const MUTED_KEY = "squiffy-player-muted";

function stored(key: string) {
    try {
        return localStorage.getItem(key);
    } catch {
        // Storage can be unavailable, e.g. in a private window
        return null;
    }
}

function store(key: string, value: string | null) {
    try {
        if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    } catch {
        // The choice just isn't remembered
    }
}

const storedTheme = stored(THEME_KEY);
let theme: PreviewTheme = storedTheme == "light" || storedTheme == "dark" ? storedTheme : "system";

// This page's own bar follows the story's light or dark
function showTheme() {
    document.documentElement.style.colorScheme = theme == "system" ? "" : theme;
}
showTheme();

function show(heading: string, text: string, detail?: string) {
    frame.hidden = true;
    bar.hidden = false;
    message.hidden = false;
    message.replaceChildren();
    // The page's only heading, as the bar has no title (#640)
    message.append(Object.assign(document.createElement("h1"), { textContent: heading }));
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
    const projectFile = (await service.getProjectInfo()).projectFile;
    // As on a published page, the story has a Back button unless its squiffy.json says not, and
    // the buttons' text can be in the story's own language
    const backButton = projectFile?.backButton !== false;
    const strings = (projectFile?.strings ?? {}) as Record<string, string>;
    // The story's images, by their paths as the story refers to them
    const assets: Record<string, Uint8Array> = {};
    for (const [path, data] of Object.entries(story.assets ?? {})) {
        const relative = storyPath(main, path);
        if (relative !== null) assets[relative] = data;
    }
    return { ...compiled, title, backButton, strings, assets };
}

async function play() {
    const payload = payloadFromFragment(location.hash);
    edit.hidden = true;
    document.title = "A Squiffy story";
    frame.title = "Story";
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
    // The author can ask for no "Open in editor" button while the story plays. One that can't be
    // played still has it, so they can see why.
    editable = story.edit !== false;
    edit.hidden = !editable;

    let compiled: Awaited<ReturnType<typeof compile>>;
    try {
        compiled = await compile(story);
    } catch (err) {
        compiled = { success: false, errors: [err instanceof Error ? err.message : String(err)] };
    }
    if (!compiled.success) {
        edit.hidden = false;
        show("This story has a problem", "It can't be played until its author fixes this. You can open it in the editor to see.", compiled.errors.join("\n"));
        return;
    }
    if (compiled.title) {
        document.title = compiled.title;
        // What a screen reader calls the frame the story is in (#640)
        frame.title = compiled.title;
    }

    if (!preview) {
        setUpPreviewFrame(frame, previewHtml);
        preview = createPreviewHost(iframeChannel(frame), {
            onThemeChosen: chosen => {
                theme = chosen;
                store(THEME_KEY, chosen == "system" ? null : chosen);
                showTheme();
            },
            onMutedChosen: muted => store(MUTED_KEY, muted ? "true" : null),
            onEditRequested: () => { if (editable) location.href = edit.href; },
            onRuntimeError: (text, stack) => console.error(text, stack),
        });
        preview.setTheme(theme);
        preview.setMuted(stored(MUTED_KEY) == "true");
    }
    message.hidden = true;
    bar.hidden = true;
    frame.hidden = false;
    // The published page's buttons, in the story's frame, as the story's own CSS styles them, with
    // the title before them and an edit button after. There's no Save, as nothing is saved.
    preview.setControls({
        back: compiled.backButton, restart: true, mute: true, theme: true, strings: compiled.strings,
        title: compiled.title, edit: editable, editLabel: edit.title,
    });
    preview.setAssets({ files: compiled.assets });
    preview.load({ js: compiled.js, css: compiled.css, scripts: compiled.scripts });
}

// Another story's link, pasted over this one
window.addEventListener("hashchange", () => void play());
void play();

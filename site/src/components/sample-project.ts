// A docs sample with files (Sample.astro's `files` and `assets`): a story as the editor has it,
// with a squiffy.json, stylesheets, scripts, and images or sounds. Each text file has a tab, and
// the story runs as it does in the editor's preview: compiled by the language service from the
// files as they are now, and played in the runtime's preview page in a sandboxed iframe, so its
// CSS and JavaScript can't change the docs page around it. Loaded only by samples with files.
import { basicSetup, EditorView } from "codemirror";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { squiffyLanguage } from "@textadventures/squiffy-codemirror";
import { emit, formatDiagnostic, resolveCssUrl, rewriteCssUrls } from "squiffy-compiler";
import { createLanguageService } from "squiffy-compiler/language-service";
import { previewHtml } from "squiffy-runtime/preview-html";
import { createPreviewHost, iframeChannel, type PreviewTheme } from "squiffy-runtime/preview-host";
import debounce from "debounce";
import { sampleEditorExtensions, setUpCopyButton, setUpOpenInEditor, SAMPLE_PROJECT_FILE as PROJECT_FILE } from "./sample-editor";

function languageFor(path: string) {
    if (path.endsWith(".squiffy")) return squiffyLanguage;
    if (path.endsWith(".css")) return css();
    if (path.endsWith(".js")) return javascript();
    if (path.endsWith(".json")) return javascript({ jsx: false });
    return [];
}

// The site's own light or dark mode, which the story follows, as the editor's preview follows
// the editor's
function siteTheme(): PreviewTheme {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export async function setUpProjectSample(sample: HTMLElement) {
    const editor = sample.querySelector(".editor") as HTMLElement;
    const viewer = sample.querySelector(".viewer") as HTMLElement;
    const tabs = sample.querySelector(".sample-tabs") as HTMLElement;

    // The files, from the <pre>s the page has for readers without JavaScript (and for llms.txt).
    // The first is the main file.
    const texts = new Map<string, string>();
    for (const pre of sample.querySelectorAll<HTMLElement>("pre.sample-source[data-path]")) {
        texts.set(pre.dataset.path!, pre.textContent ?? "");
    }
    sample.querySelectorAll(".sample-source").forEach(e => e.remove());
    const main = [...texts.keys()][0];
    const shown = [...texts.keys()];
    // Without a squiffy.json of its own, the sample has the one every new story has, which makes
    // its stylesheets and scripts part of the story, as in the editor
    if (!texts.has(PROJECT_FILE)) texts.set(PROJECT_FILE, JSON.stringify({ version: 1, main }));
    const assets: Record<string, string> = JSON.parse(sample.dataset.assets || "{}");

    const service = createLanguageService({
        mainFile: main,
        files: {
            list: async () => [...texts.keys(), ...Object.keys(assets)].map(path => ({ path })),
            readText: async path => {
                const text = texts.get(path);
                if (text === undefined) throw new Error(`No file ${path}`);
                return text;
            },
        },
    });

    // An editor for each file, with a tab to show it
    const views = new Map<string, EditorView>();
    let current = main;
    const tabButtons = new Map<string, HTMLButtonElement>();
    const show = (path: string) => {
        current = path;
        for (const [p, view] of views) view.dom.hidden = p !== path;
        for (const [p, button] of tabButtons) {
            button.setAttribute("aria-selected", String(p === path));
            button.tabIndex = p === path ? 0 : -1;
        }
    };
    for (const path of shown) {
        const button = document.createElement("button");
        button.type = "button";
        button.role = "tab";
        button.className = "sample-tab";
        button.textContent = path;
        button.addEventListener("click", () => show(path));
        // Left and right move between the tabs, as in other tab lists
        button.addEventListener("keydown", e => {
            const i = shown.indexOf(path);
            const next = e.key === "ArrowRight" ? shown[(i + 1) % shown.length]
                : e.key === "ArrowLeft" ? shown[(i + shown.length - 1) % shown.length] : undefined;
            if (!next) return;
            e.preventDefault();
            show(next);
            tabButtons.get(next)?.focus();
        });
        tabs.appendChild(button);
        tabButtons.set(path, button);

        views.set(path, new EditorView({
            doc: texts.get(path),
            extensions: [
                basicSetup,
                languageFor(path),
                ...sampleEditorExtensions,
                EditorView.updateListener.of(update => {
                    if (!update.docChanged) return;
                    const text = update.state.doc.toString();
                    texts.set(path, text);
                    service.updateFile(path, text);
                    // A script can't be swapped into a running story, so that starts it again
                    if (path.endsWith(".js") || path === PROJECT_FILE) needsLoad = true;
                    changed();
                }),
            ],
            parent: editor,
        }));
    }
    show(main);
    setUpCopyButton(sample, () => views.get(current)!.state.doc.toString());
    setUpOpenInEditor(sample, () => ({ main, files: Object.fromEntries(texts) }));

    // The story, compiled as the editor's preview compiles it (app/src/lib/language/worker.ts)
    const compile = async () => {
        const analysis = await service.getAnalysis();
        if (!analysis.success) {
            console.error("Failed to compile sample", analysis.diagnostics.filter(d => d.severity === "error").map(formatDiagnostic));
            return undefined;
        }
        const { projectFile } = await service.getProjectInfo();
        const result = emit(analysis, { panels: projectFile?.panels, settings: projectFile?.settings });
        const info = result.getUiInfo();
        const read = (names: string[], stylesheets: boolean) => names
            .map(name => {
                const text = texts.get(name);
                return text !== undefined && stylesheets ? rewriteCssUrls(text, url => resolveCssUrl(name, url) ?? undefined) : text;
            })
            .filter((t): t is string => t !== undefined);
        return { js: await result.getJs(true), css: read(info.externalStylesheets, true), scripts: read(info.externalScripts, false) };
    };

    const restartButton = sample.querySelector(".restart") as HTMLButtonElement;
    const backButton = sample.querySelector(".back") as HTMLButtonElement;
    const muteButton = sample.querySelector(".mute") as HTMLButtonElement;

    const iframe = document.createElement("iframe");
    iframe.className = "sample-frame";
    iframe.title = "The story";
    // As setUpPreviewFrame does, but without its allow="autoplay", which lets the editor's preview
    // start music when the author presses Run. On a docs page, that would let a sample start its
    // music as the page loads, so a sample's sound waits until the reader clicks in it, as a
    // published story's does.
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.srcdoc = previewHtml;
    viewer.appendChild(iframe);
    let started = false;
    const host = createPreviewHost(iframeChannel(iframe), {
        // A second ready means the page reloaded, and lost the story
        onReady: () => {
            if (started) void load();
        },
        onCanGoBackChanged: canGoBack => {
            backButton.disabled = !canGoBack;
        },
        onUsesSound: usesSound => {
            muteButton.hidden = !usesSound;
        },
        onRuntimeError: message => console.error("Error in sample", message),
    });
    host.setTheme(siteTheme());
    new MutationObserver(() => host.setTheme(siteTheme()))
        .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // The sounds and images, fetched from the site and handed to the preview, which can't load
    // the site's URLs itself from its sandbox
    const files: Record<string, Blob> = {};
    await Promise.all(Object.entries(assets).map(async ([path, url]) => {
        try {
            const response = await fetch(url);
            if (response.ok) files[path] = await response.blob();
        } catch (error) {
            console.error(`Couldn't load ${url} for a sample`, error);
        }
    }));
    host.setAssets({ files });

    let needsLoad = false;
    async function load() {
        needsLoad = false;
        const story = await compile();
        if (!story) return;
        started = true;
        backButton.disabled = true;
        host.load(story);
    }
    // After an edit: the story carries on with the new text, as in the editor, unless a script
    // or squiffy.json changed
    const changed = debounce(async () => {
        if (needsLoad || !started) {
            await load();
            return;
        }
        const story = await compile();
        if (story) host.update(story.js, story.css);
    }, 500);

    backButton.addEventListener("click", () => host.back());
    restartButton.addEventListener("click", () => void load());
    let muted = false;
    muteButton.addEventListener("click", () => {
        muted = !muted;
        host.setMuted(muted);
        muteButton.setAttribute("aria-pressed", String(muted));
        muteButton.title = muted ? "Unmute" : "Mute";
        muteButton.setAttribute("aria-label", muteButton.title);
    });

    await load();
}

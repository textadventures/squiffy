// The preview page's logic: runs stories sent by a host, and reports back what happens. The
// page itself (preview.main.ts) connects this to postMessage; it's separate so it can be tested.

import { init } from "./squiffy.runtime.js";
import { createPanels, type Panels } from "./panels.js";
import { createSettingsDialog, SETTINGS_ICON, type SettingsDialog } from "./settingsDialog.js";
import { confirmDialog } from "./confirmDialog.js";
import { BACK_ICON, EDIT_ICON, MUTE_ICONS, RESTART_ICON, THEME_ICONS } from "./headerIcons.js";
import type { HostMessage, PreviewAssets, PreviewControls, PreviewMessage, PreviewStory, PreviewTheme } from "./preview-protocol.js";
import type { Panel, PlayerSetting, SquiffyApi, Story } from "./types.js";

export interface PreviewOptions {
    // Where to show the story
    element: HTMLElement;
    send(message: PreviewMessage): void;
    // Loads a compiled story module. By default it's imported from a blob URL, so story
    // JavaScript runs without new Function (and so without unsafe-eval in a CSP).
    loadModule?(js: string): Promise<{ story: Story }>;
    // Reloads the page, for a "reload" message
    reload?(): void;
}

// The English for the published page's buttons, as in the compiler's PAGE_STRINGS
const CONTROL_STRINGS: Record<string, string> = {
    back: "Back",
    restart: "Restart",
    restartConfirm: "Are you sure you want to restart?",
    cancel: "Cancel",
    switchToDark: "Switch to dark mode",
    switchToLight: "Switch to light mode",
    mute: "Mute",
    unmute: "Unmute",
    settings: "Settings",
};

// How long the opening text stays in the preview's live region, for a screen reader to read it out
// (see announce in createPreview). Emptying it doesn't stop what's being read.
export const ANNOUNCEMENT_TIME = 3000;

// How long the note saying a link goes nowhere stays (see showBrokenLinkNote in createPreview)
export const BROKEN_LINK_NOTE_TIME = 4000;

const mimeTypes: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp",
    mp3: "audio/mpeg", ogg: "audio/ogg", oga: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", flac: "audio/flac",
    mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
    pdf: "application/pdf", vtt: "text/vtt",
};

const mimeType = (path: string) => mimeTypes[path.substring(path.lastIndexOf(".") + 1).toLowerCase()] ?? "";

const normalisePath = (path: string) => path.replace(/^(\.\/)+/, "");

// The url()s in a story's stylesheet that are paths, rather than web addresses, data: URIs and the like
const CSS_URL = /url\(\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|([^)"'\s]*))\s*\)/gi;
const isRelativeUrl = (url: string) => url != "" && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url);

async function importFromBlob(js: string): Promise<{ story: Story }> {
    const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
    try {
        return await import(/* @vite-ignore */ url);
    }
    finally {
        URL.revokeObjectURL(url);
    }
}

function errorMessage(error: unknown): PreviewMessage {
    if (error instanceof Error) {
        return { type: "runtimeError", message: error.message, ...(error.stack ? { stack: error.stack } : {}) };
    }
    return { type: "runtimeError", message: String(error) };
}

// A link to another site opens in a new tab, where its own address shows, and not in the preview's
// frame. The player's frame can't load another site at all (its Content-Security-Policy has
// frame-src 'none', in player/vite.config.ts), so a story shared as a link can't show another
// site under squiffystories.com's address. The host's sandbox lets the new tab escape it.
// The target is set as the link is clicked, rather than the click being cancelled, so that a host
// that handles links itself, as a VS Code webview does, still sees an ordinary click on a link.
function openOtherSitesInNewTab(event: MouseEvent) {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    const link = event.target.closest("a[href]");
    if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download")) return;
    if (link.protocol != "http:" && link.protocol != "https:") return;
    link.target = "_blank";
    const rel = new Set(link.rel.split(/\s+/).filter(Boolean));
    rel.add("noopener").add("noreferrer");
    link.rel = [...rel].join(" ");
}

export function createPreview(options: PreviewOptions) {
    const loadModule = options.loadModule ?? importFromBlob;
    let api: SquiffyApi | undefined;
    // The story's panels (squiffy.json's "panels"), shown as on the published page: their buttons
    // in a bar above the story, and side panels beside it if the preview is wide enough
    let panels: Panels | undefined;
    let panelsJson = "";
    let panelButtons: HTMLElement | undefined;
    // The bar they're in, which has the story's title before them if the host asks
    let header: HTMLElement | undefined;
    // The Settings button (#452), after the panels' buttons, for a story with "settings"
    let settingsButton: HTMLButtonElement | undefined;
    let settingsDialog: SettingsDialog | undefined;
    let panelSide: HTMLElement | undefined;
    // The runtime puts the story's classes (@class, {{addclass}}, settings such as
    // setting-textSize-Large) on the element it's given, which here is inside the header and side
    // panels' layout. They're copied to the preview's own element, which is #squiffy as on a
    // published page, so stylesheets with rules such as div#squiffy.dark work here too.
    let classObserver: MutationObserver | undefined;
    let mirroredClasses: string[] = [];
    // The host's mute button (#444), which carries on to the next story loaded
    let muted = false;
    let usesSound = false;
    // The published page's buttons, if the host asked for them (see PreviewControls): Back and
    // Restart after the panels' buttons, then Settings, then mute and light/dark
    let controls: PreviewControls = {};
    let controlButtons: HTMLButtonElement[] = [];
    let backButton: HTMLButtonElement | undefined;
    let muteButton: HTMLButtonElement | undefined;
    let themeButton: HTMLButtonElement | undefined;
    // The theme the host or the reader chose, and whether the story's CSS fixes it
    let theme: PreviewTheme = "system";
    let themeFixed = false;
    const systemDark = typeof window.matchMedia == "function" ? window.matchMedia("(prefers-color-scheme: dark)") : undefined;
    systemDark?.addEventListener("change", () => updateThemeButton());
    // Each load gets a new number, so a slow load that's been replaced doesn't start
    let loadCount = 0;
    // Reads the story's opening text out with a screen reader when it starts or restarts (#639).
    // After a link is clicked, the runtime moves the focus to the new text, which a screen reader
    // then reads, but nothing does that for the opening: the reader pressed Run in the host, or
    // Restart, and the focus stays there. Outside the element the story is shown in, which is
    // emptied on each load.
    const announcer = document.createElement("div");
    announcer.className = "squiffy-preview-announcer";
    announcer.setAttribute("aria-live", "polite");
    announcer.setAttribute("aria-atomic", "true");
    Object.assign(announcer.style, {
        position: "absolute", width: "1px", height: "1px", margin: "-1px", padding: "0", border: "0",
        overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap",
    });
    options.element.after(announcer);
    document.addEventListener("click", openOtherSitesInNewTab);
    // Whether to read out the text the story shows next
    let announceNext = false;
    let announcing: ReturnType<typeof setTimeout> | undefined;
    function announce(container: Element) {
        const sections = container.querySelectorAll(".squiffy-output-section");
        const text = sections[sections.length - 1]?.textContent?.replace(/\s+/g, " ").trim();
        if (!text) return;
        // Emptied first, so the same opening is read out again after a restart
        announcer.textContent = "";
        clearTimeout(announcing);
        announcing = setTimeout(() => {
            announcer.textContent = text;
            // And emptied again once it's been read, as it's still on the page, where a screen
            // reader's browse mode would read the opening a second time after the story's own (#640)
            announcing = setTimeout(() => { announcer.textContent = ""; }, ANNOUNCEMENT_TIME);
        }, 50);
    }
    function restart() {
        announceNext = true;
        api?.restart();
    }
    const assetUrls = new Map<string, string>();
    const objectUrls: string[] = [];
    // The story's own stylesheets and scripts
    let styles: HTMLStyleElement[] = [];
    // Their text as the host sent it, before withAssetUrls
    let styleTexts: string[] = [];
    let scripts: HTMLScriptElement[] = [];
    // Sets the theme. It's added before any of the story's own stylesheets, so they can override it.
    const themeStyle = document.createElement("style");
    document.head.appendChild(themeStyle);

    const send = (message: PreviewMessage) => {
        try {
            options.send(message);
        }
        catch {
            // e.g. an attribute value that can't be cloned
            if (message.type == "attributeSet") options.send({ ...message, value: String(message.value) });
        }
    };

    // Whether the story's stylesheets set color-scheme themselves: if they do, the story looks the
    // same whichever theme the preview is set to
    function themeIsFixed(): boolean {
        const theme = themeStyle.textContent;
        const schemeFor = (scheme: string) => {
            themeStyle.textContent = `:root { color-scheme: ${scheme}; }`;
            return getComputedStyle(document.documentElement).getPropertyValue("color-scheme");
        };
        const fixed = schemeFor("light") == schemeFor("dark");
        themeStyle.textContent = theme;
        return fixed;
    }

    const string = (name: string) => {
        const value = controls.strings?.[name];
        return typeof value == "string" ? value : CONTROL_STRINGS[name];
    };

    function setTheme(value: PreviewTheme) {
        theme = value;
        themeStyle.textContent = theme == "system" ? "" : `:root { color-scheme: ${theme}; }`;
        updateThemeButton();
    }

    function setThemeFixed(fixed: boolean) {
        themeFixed = fixed;
        send({ type: "themeFixed", fixed });
        updateThemeButton();
    }

    const systemTheme = (): "light" | "dark" => systemDark?.matches ? "dark" : "light";

    // As on the published page: the button switches to the theme that isn't showing, and
    // choosing the system's own theme goes back to following it
    function updateThemeButton() {
        if (!themeButton) return;
        themeButton.hidden = themeFixed;
        const next = (theme == "system" ? systemTheme() : theme) == "dark" ? "light" : "dark";
        themeButton.dataset.next = next;
        themeButton.title = string(next == "dark" ? "switchToDark" : "switchToLight");
        themeButton.setAttribute("aria-label", themeButton.title);
    }

    function updateMuteButton() {
        if (!muteButton) return;
        muteButton.hidden = !usesSound;
        muteButton.title = string(muted ? "unmute" : "mute");
        muteButton.setAttribute("aria-label", muteButton.title);
        muteButton.classList.toggle("squiffy-muted", muted);
    }

    function controlButton(id: string, icon: string, onClick: () => void, label?: string) {
        const button = document.createElement("button");
        button.type = "button";
        button.id = id;
        button.className = "squiffy-header-button";
        button.innerHTML = icon;
        if (label) {
            button.title = label;
            button.setAttribute("aria-label", label);
        }
        button.addEventListener("click", onClick);
        controlButtons.push(button);
        return button;
    }

    // Shows the buttons the host asked for, replacing any already shown
    function renderControls() {
        for (const button of controlButtons) button.remove();
        controlButtons = [];
        backButton = muteButton = themeButton = undefined;
        if (!panelButtons || !header || !api) return;
        renderTitle();
        const buttons = panelButtons;
        const current = api;
        const beforeSettings = settingsButton ?? null;
        if (controls.back) {
            backButton = controlButton("squiffy-back", BACK_ICON, () => api?.goBack(), string("back"));
            backButton.disabled = !current.canGoBack();
            buttons.insertBefore(backButton, beforeSettings);
        }
        if (controls.restart) {
            buttons.insertBefore(controlButton("squiffy-restart", RESTART_ICON, async () => {
                const restarting = api;
                if (!await confirmDialog({ message: string("restartConfirm"), confirm: string("restart"), cancel: string("cancel") })) return;
                if (api == restarting) restart();
            }, string("restart")), beforeSettings);
        }
        if (controls.mute) {
            muteButton = controlButton("squiffy-mute", MUTE_ICONS, () => {
                muted = !muted;
                api?.setMuted(muted);
                send({ type: "mutedChosen", muted });
                updateMuteButton();
            });
            buttons.appendChild(muteButton);
            updateMuteButton();
        }
        if (controls.theme) {
            themeButton = controlButton("squiffy-theme", THEME_ICONS, () => {
                const chosen = themeButton!.dataset.next as "light" | "dark";
                setTheme(chosen == systemTheme() ? "system" : chosen);
                send({ type: "themeChosen", theme });
            });
            buttons.appendChild(themeButton);
            updateThemeButton();
        }
        if (controls.edit) {
            const label = controls.editLabel ?? "Open in editor";
            buttons.appendChild(controlButton("squiffy-edit", EDIT_ICON, () => send({ type: "editRequested" }), label));
        }
        updateHeaderLayout();
    }

    // The title at the left of the header: the one the story's header would show (squiffy.json's
    // "headerTitle", {{headertitle}}), or else the one the host gave (the player's, the story's title)
    function renderTitle() {
        if (!header || !api) return;
        const text = api.headerTitle() || controls.title;
        let title = header.querySelector<HTMLElement>(".squiffy-preview-title");
        if (!text) {
            title?.remove();
        }
        else {
            if (!title) {
                title = document.createElement("span");
                title.className = "squiffy-preview-title";
                header.prepend(title);
            }
            title.textContent = text;
        }
        updateHeaderLayout();
    }

    // With a title or the published page's buttons, the header lines up with the story's text
    function updateHeaderLayout() {
        header?.classList.toggle("squiffy-preview-controls",
            controlButtons.length > 0 || !!header.querySelector(".squiffy-preview-title"));
    }

    // Says why a link to a section or passage that doesn't exist did nothing (#704), for the author.
    // Not for a reader: a host showing the published page's buttons is showing the story to one.
    let brokenLinkNote: HTMLElement | undefined;
    let brokenLinkTimer: ReturnType<typeof setTimeout> | undefined;
    function showBrokenLinkNote(linkType: "section" | "passage", name: string) {
        if (Object.values(controls).some(v => v === true)) return;
        if (!brokenLinkNote) {
            brokenLinkNote = document.createElement("div");
            brokenLinkNote.className = "squiffy-preview-note";
            brokenLinkNote.setAttribute("role", "status");
            options.element.after(brokenLinkNote);
        }
        brokenLinkNote.textContent = `No ${linkType} called "${name}", so the link does nothing.`;
        brokenLinkNote.hidden = false;
        clearTimeout(brokenLinkTimer);
        brokenLinkTimer = setTimeout(() => { if (brokenLinkNote) brokenLinkNote.hidden = true; }, BROKEN_LINK_NOTE_TIME);
    }

    const resolveAssetUrl = (path: string) => assetUrls.get(normalisePath(path)) ?? path;

    function setAssets(assets: PreviewAssets) {
        for (const url of objectUrls.splice(0)) URL.revokeObjectURL(url);
        assetUrls.clear();
        for (const [path, url] of Object.entries(assets.urls ?? {})) {
            assetUrls.set(normalisePath(path), url);
        }
        for (const [path, data] of Object.entries(assets.files ?? {})) {
            const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mimeType(path) });
            const url = URL.createObjectURL(blob);
            objectUrls.push(url);
            assetUrls.set(normalisePath(path), url);
        }
        // The stylesheets' url()s, such as their fonts, may now be different files
        styles.forEach((style, i) => { style.textContent = withAssetUrls(styleTexts[i]); });
    }

    // A stylesheet with its url()s, which are paths from the story's folder, swapped for the
    // assets' URLs. One that isn't an asset is left as it is.
    const withAssetUrls = (css: string) => css.replace(CSS_URL, (match, double?: string, single?: string, bare?: string) => {
        const url = (double ?? single ?? bare ?? "").trim();
        const resolved = isRelativeUrl(url) ? assetUrls.get(normalisePath(url)) : undefined;
        return resolved ? `url("${resolved}")` : match;
    });

    // Replaces the story's stylesheets, where the old ones were, so they stay before its scripts
    // (which may add styles of their own). Returns false if they haven't changed.
    function setStyles(css: string[]): boolean {
        if (css.length == styleTexts.length && css.every((text, i) => styleTexts[i] == text)) return false;
        const before = styles[0] ?? scripts[0] ?? null;
        const added = css.map(text => {
            const style = document.createElement("style");
            style.textContent = withAssetUrls(text);
            document.head.insertBefore(style, before);
            return style;
        });
        for (const style of styles) style.remove();
        styles = added;
        styleTexts = [...css];
        return true;
    }

    async function addStoryFiles(story: PreviewStory) {
        for (const element of [...styles, ...scripts]) element.remove();
        styles = [];
        styleTexts = [];
        scripts = [];
        setStyles(story.css ?? []);
        for (const js of story.scripts ?? []) {
            const script = document.createElement("script");
            const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
            await new Promise<void>(resolve => {
                script.onload = script.onerror = () => resolve();
                script.src = url;
                document.head.appendChild(script);
            });
            URL.revokeObjectURL(url);
            scripts.push(script);
        }
    }

    function mirrorClasses(from: HTMLElement | undefined) {
        const classes = from ? [...from.classList].filter(c => c != "squiffy-preview-story") : [];
        for (const c of mirroredClasses) {
            if (!classes.includes(c)) options.element.classList.remove(c);
        }
        for (const c of classes) options.element.classList.add(c);
        mirroredClasses = classes;
    }

    async function load(message: Extract<HostMessage, { type: "load" }>) {
        const thisLoad = ++loadCount;
        announceNext = true;
        api?.dispose();
        api = undefined;
        classObserver?.disconnect();
        classObserver = undefined;
        mirrorClasses(undefined);
        options.element.innerHTML = "";
        await addStoryFiles(message.story);
        const { story } = await loadModule(message.story.js);
        if (thisLoad != loadCount) return;
        setThemeFixed(themeIsFixed());

        panels?.dispose();
        panels = undefined;
        panelsJson = "";
        settingsDialog?.element.remove();
        settingsDialog = undefined;
        settingsButton = undefined;
        header = document.createElement("div");
        header.className = "squiffy-preview-header";
        panelButtons = document.createElement("div");
        panelButtons.className = "squiffy-preview-buttons";
        header.appendChild(panelButtons);
        panelSide = document.createElement("div");
        panelSide.className = "squiffy-preview-body";
        const container = document.createElement("div");
        container.className = "squiffy-preview-story";
        panelSide.appendChild(container);
        options.element.append(header, panelSide);
        classObserver = new MutationObserver(() => mirrorClasses(container));
        classObserver.observe(container, { attributes: true, attributeFilter: ["class"] });

        const newApi = await init({
            element: container,
            story,
            persist: false,
            scroll: "element",
            resolveAssetUrl,
            // For the text the story itself shows, such as a video's "Watch on YouTube"
            strings: controls.strings,
            showUnsetNames: message.showUnsetNames === true,
            onSet: (name, value) => {
                if (thisLoad == loadCount && !name.startsWith("_")) send({ type: "attributeSet", name, value });
            },
        });
        newApi.on("canGoBackChanged", e => {
            if (thisLoad != loadCount) return;
            if (backButton) backButton.disabled = !e.canGoBack;
            send({ type: "canGoBackChanged", canGoBack: e.canGoBack });
        });
        newApi.on("headerTitleChanged", () => {
            if (thisLoad == loadCount) renderTitle();
        });
        newApi.on("navigated", e => {
            if (thisLoad != loadCount) return;
            send({ type: "navigated", ...e });
            if (announceNext) {
                announceNext = false;
                announce(container);
            }
        });
        newApi.on("brokenLink", e => {
            if (thisLoad == loadCount) showBrokenLinkNote(e.linkType, e.name);
        });
        newApi.on("sound", () => {
            if (thisLoad == loadCount && !usesSound) {
                usesSound = true;
                send({ type: "usesSound", usesSound });
                updateMuteButton();
            }
        });
        newApi.setMuted(muted);
        usesSound = newApi.usesSound();
        send({ type: "usesSound", usesSound });
        api = newApi;
        setPanels(story.panels);
        setSettingsButton(story.settings);
        renderControls();
        send({ type: "canGoBackChanged", canGoBack: false });
        await newApi.begin(message.startAt);
        // A story can start somewhere there's something to go back to
        if (thisLoad == loadCount && backButton) backButton.disabled = !newApi.canGoBack();
        // Now, rather than waiting for the observer, so they're there when the host hears it's loaded
        if (thisLoad == loadCount) mirrorClasses(container);
        if (thisLoad == loadCount) send({ type: "loaded" });
    }

    // Shows the story's panels, or shows them again if they've changed
    function setPanels(list: Panel[] | undefined) {
        const json = JSON.stringify(list ?? []);
        if (!api || !panelButtons || json == panelsJson) return;
        panelsJson = json;
        panels?.dispose();
        panels = list?.length ? createPanels(api, { panels: list, buttons: panelButtons, side: panelSide }) : undefined;
    }

    // Shows the Settings button if the story has settings
    function setSettingsButton(list: PlayerSetting[] | undefined) {
        if (!api || !panelButtons) return;
        if (!list?.length) {
            settingsButton?.remove();
            settingsButton = undefined;
            return;
        }
        // Before the mute, light/dark and edit buttons, if there are any
        const before = muteButton ?? themeButton ?? panelButtons.querySelector("#squiffy-edit");
        if (settingsButton) {
            panelButtons.insertBefore(settingsButton, before);
            return;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "squiffy-header-button squiffy-settings-button";
        button.title = string("settings");
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-haspopup", "dialog");
        button.innerHTML = SETTINGS_ICON;
        button.addEventListener("click", () => {
            if (!api) return;
            settingsDialog ??= createSettingsDialog(api, { strings: controls.strings });
            settingsDialog.open();
        });
        panelButtons.insertBefore(button, before);
        settingsButton = button;
    }

    async function receive(message: HostMessage) {
        try {
            switch (message.type) {
                case "load":
                    await load(message);
                    break;
                case "update":
                    if (!api) break;
                    // A stylesheet can change whether the story sets its own color-scheme
                    if (message.css && setStyles(message.css)) setThemeFixed(themeIsFixed());
                    {
                        const { story } = await loadModule(message.js);
                        api.update(story);
                        setPanels(story.panels);
                        setSettingsButton(story.settings);
                    }
                    break;
                case "restart":
                    restart();
                    break;
                case "back":
                    api?.goBack();
                    break;
                case "assets":
                    setAssets(message.assets);
                    break;
                case "muted":
                    muted = message.muted;
                    api?.setMuted(muted);
                    updateMuteButton();
                    break;
                case "controls":
                    controls = message.controls;
                    renderControls();
                    // The Settings button's text may have changed with the strings
                    if (settingsButton) {
                        settingsButton.title = string("settings");
                        settingsButton.setAttribute("aria-label", settingsButton.title);
                    }
                    settingsDialog?.element.remove();
                    settingsDialog = undefined;
                    break;
                case "reload":
                    options.reload?.();
                    break;
                case "theme":
                    setTheme(message.theme);
                    break;
            }
        }
        catch (error) {
            send(errorMessage(error));
        }
    }

    return { receive };
}

export { errorMessage };

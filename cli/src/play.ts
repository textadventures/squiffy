// --play: plays a story without a browser, in jsdom, and prints what the player would see as
// text, with the links they can click. It's for checking a story from the command line, and
// for AI agents, which can't click through a story in a browser:
//
// - Clicking links in order with --choose, and filling in text boxes with --input
// - Carrying on from one run to the next with --save, a saved game in a file
// - --random, which plays the story many times clicking links at random, and reports errors,
//   dead ends, endings reached and sections never visited, each error with the --choose
//   options that get back to it
//
// Time passes at once: a {{goto}} with after=, or a transition, happens straight away, rather
// than after waiting.

import fs from "fs";
import util from "util";
import { analyse, emit, formatDiagnostic } from "squiffy-compiler";
import type { StoryOnDisk } from "squiffy-compiler/node";
import type { SavedGame, SquiffyApi } from "squiffy-runtime";
import { compileSettings } from "./file-packager.js";
import { storyService } from "./check.js";

// ---- The story, compiled to play ----

export interface PlayableStory {
    // The runtime's story data, with its JavaScript as functions
    story: any;
    // The sections marked @end
    endings: Set<string>;
    // The story's sections, not counting the master section "", or any only shown inside others
    sections: string[];
    // Its passages, as "section/passage", not counting special ones such as @last, or any only
    // shown inside others
    passages: string[];
    // Script files the story adds to its page, which aren't run here
    scripts: string[];
    // What to call the sections without names of their own, rather than the names the compiler
    // gives them (_default, _continue1, ...), e.g. 'the "+++Continue..." after "cave"'
    labels: Map<string, string>;
}

export type LoadResult = { success: true; playable: PlayableStory } | { success: false; errors: string[] };

export async function loadPlayableStory(story: StoryOnDisk): Promise<LoadResult> {
    const script = fs.readFileSync(story.mainFile, "utf8");
    const analysis = await analyse(compileSettings(story, script));
    if (!analysis.success) {
        return { success: false, errors: analysis.diagnostics.filter(d => d.severity == "error").map(formatDiagnostic) };
    }
    const compiled = emit(analysis, { projectId: story.projectId, panels: story.panels, settings: story.settings, persistent: story.persistent, headerTitle: story.headerTitle });
    let js: ((...args: unknown[]) => unknown)[];
    try {
        js = compiled.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n")) as (...args: unknown[]) => unknown);
    }
    catch (e) {
        // The compiler reports JavaScript that doesn't parse, so this shouldn't happen
        return { success: false, errors: [`The story's JavaScript isn't valid: ${e instanceof Error ? e.message : String(e)}`] };
    }

    // Sections and passages that are only shown inside others, with {{embed}} or {{live}},
    // are never visited, so they're left out, as are the master section's passages that are
    // squiffy.json's panels
    const graph = await storyService(story).service.getStoryGraph();
    // Sections for testing the story (@test, and what only they lead to) aren't part of what a
    // player sees, so random play isn't expected to visit them. --start can still start at one.
    const sectionNodes = graph.nodes.filter(n => n.kind == "section" && n.name != "" && !n.test);
    const panels = new Set((story.panels ?? []).map(panel => panel.passage));
    const passageNodes = graph.nodes.filter(n => n.kind == "passage" && !n.embedded && !n.test && !n.name.startsWith("@")
        && !(n.section == "" && panels.has(n.name)));

    return {
        success: true,
        playable: {
            story: { ...compiled.output.story, js },
            endings: new Set(sectionNodes.filter(n => n.ending).map(n => n.name)),
            sections: sectionNodes.filter(n => !n.embedded).map(n => n.name),
            passages: passageNodes.map(n => `${n.section}/${n.name}`),
            scripts: compiled.getUiInfo().externalScripts,
            labels: new Map(sectionNodes.filter(n => n.detail && n.label).map(n => [n.name, n.label!])),
        },
    };
}

// ---- Somewhere to play: jsdom, with time that passes at once ----

// A random number generator from a seed (mulberry32)
export function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Timers set by {{goto ... after=}}, transitions and the like run one after another, in the order
// they'd have run, up to this many in a row before giving up: a story that moves on by itself
// forever, such as a clock, would otherwise never stop.
// Links that do what the page's buttons do, rather than go somewhere in the story
const PAGE_LINKS = new Set(["restart", "saves", "settings"]);

const MAX_TIMERS = 100;
// An {{#every}} (#451) can show its text again forever, such as a clock, so once its text has been
// shown this many times in a row, with nothing else waiting to happen, play stops waiting for it
const MAX_EVERY_TICKS = 20;
// How the runtime marks the timers for {{#every}}s (EVERY_TICK in runtime/src/every.ts)
const isEveryTick = (fn: unknown) => !!(fn as Record<string, unknown>)?.squiffyEvery;
// How long to wait for something that isn't a timer before giving up
const MAX_REAL_WAIT = 10000;
// Animation frames are this far apart, in milliseconds
const FRAME_TIME = 100;
// How long a CSS transition takes
const TRANSITION_TIME = 500;
// The most animation frames to run in a row: more than enough for any animation that ends
const MAX_FRAMES = 600;

// The time skipped so far, in milliseconds. Date.now() and performance.now() are ahead of the
// real time by this much while a story's playing, as Anime.js keeps the Date.now it finds when
// it's first imported.
let skipped = 0;
const realDateNow = Date.now;
const virtualDateNow = () => realDateNow() + skipped;

// Animation frames waiting to run. The functions that ask for them are the same for every
// environment, as Anime.js keeps the requestAnimationFrame it finds when it's first imported.
let activeFrames: Map<number, (time: number) => void> | undefined;
let nextFrameId = 1;
const requestFrame = (fn: (time: number) => void) => {
    const id = nextFrameId++;
    activeFrames?.set(id, fn);
    return id;
};
const cancelFrame = (id: number) => activeFrames?.delete(id);

interface Environment {
    // Waits until the story has finished doing what it's doing, e.g. after a click, or is
    // waiting for the player to do something
    settle(action?: Promise<unknown>, waitingForPlayer?: () => boolean): Promise<{ error?: unknown; stillGoing: boolean; repeating?: boolean }>;
    // Errors and other messages since this was last called: the story's console output, and
    // anything thrown by a timer
    takeMessages(): { errors: string[]; console: string[] };
    seed(seed: number | undefined): void;
    close(): void;
}

const formatError = (e: unknown) => e instanceof Error ? (e.message || String(e)) : String(e);

async function createEnvironment(): Promise<Environment> {
    const { JSDOM, VirtualConsole } = await import("jsdom");
    const errors: string[] = [];
    const consoleLines: string[] = [];

    // jsdom's own complaints, such as "Not implemented: HTMLMediaElement.prototype.play", are
    // about what jsdom can't do, not problems with the story
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", error => {
        if (!/Not implemented/i.test(error.message)) errors.push(formatError(error));
    });
    const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
        url: "http://localhost/", pretendToBeVisual: true, virtualConsole,
    });
    const window = dom.window;
    // There's no scrolling in jsdom, and nothing to scroll anyway
    window.Element.prototype.scrollIntoView = () => {};
    window.scrollTo = () => {};
    // Nor any layout, so nothing's ever resized or scrolled into view, and no media queries
    // match, but stories and the libraries they use (such as Anime.js) can still use them
    const w = window as any;
    class NoObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    w.ResizeObserver ??= NoObserver;
    w.IntersectionObserver ??= NoObserver;
    const fonts = { status: "loaded", ready: Promise.resolve(), addEventListener() {}, removeEventListener() {}, check: () => true, load: async () => [] };
    if (!("fonts" in window.document)) Object.defineProperty(window.document, "fonts", { value: fonts });
    fonts.ready = Promise.resolve(fonts) as Promise<any>;
    w.matchMedia ??= (media: string) => ({
        matches: false, media, onchange: null,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    });

    // The runtime expects to be in a browser, so the window's properties become globals, as
    // global-jsdom does, apart from those Node already has
    const g = globalThis as any;
    const added: string[] = [];
    for (const key of Object.getOwnPropertyNames(window)) {
        if (key in g || key.startsWith("_")) continue;
        try {
            g[key] = (window as any)[key];
            added.push(key);
        }
        catch {
            // Some can't be copied
        }
    }

    // The story's console output is collected rather than printed, so it doesn't get mixed up
    // with the transcript or the JSON
    const originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
    console.error = (...args) => errors.push(util.format(...args));
    for (const level of ["log", "info", "warn", "debug"] as const) {
        console[level] = (...args) => consoleLines.push(`console.${level}: ${util.format(...args)}`);
    }
    const onRejection = (reason: unknown) => errors.push(formatError(reason));
    process.on("unhandledRejection", onRejection);

    const originalRandom = Math.random;

    // Time passes at once. Timers with no delay run as usual. Longer ones are kept, and run in
    // order once there's nothing else happening, as if their time had passed. Animation frames
    // run a tenth of a second apart, so an animation finishes in a few of them.
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const realPerformanceNow = performance.now;
    const virtualPerformanceNow = () => realPerformanceNow.call(performance) + skipped;
    const pending = new Set<unknown>();
    let later: { id: number; due: number; fn: (...args: unknown[]) => void; args: unknown[] }[] = [];
    const frames = new Map<number, (time: number) => void>();
    activeFrames = frames;
    let nextId = 1;
    const run = (fn: (...args: unknown[]) => void, args: unknown[]) => {
        try {
            fn(...args);
        }
        catch (e) {
            errors.push(formatError(e));
        }
    };
    g.setTimeout = (fn: unknown, ms?: number, ...args: unknown[]) => {
        if (typeof fn != "function") return 0;
        if (!ms || ms <= 0) {
            const handle = realSetTimeout(() => {
                pending.delete(handle);
                run(fn as () => void, args);
            }, 0);
            pending.add(handle);
            return handle;
        }
        const id = nextId++;
        later.push({ id, due: skipped + ms, fn: fn as () => void, args });
        return id;
    };
    g.clearTimeout = (handle: unknown) => {
        if (typeof handle == "number") {
            later = later.filter(t => t.id != handle);
        }
        else if (pending.has(handle)) {
            pending.delete(handle);
            realClearTimeout(handle as ReturnType<typeof setTimeout>);
        }
        else {
            realClearTimeout(handle as ReturnType<typeof setTimeout>);
        }
    };
    performance.now = virtualPerformanceNow;
    Date.now = virtualDateNow;
    g.requestAnimationFrame = w.requestAnimationFrame = requestFrame;
    g.cancelAnimationFrame = w.cancelAnimationFrame = cancelFrame;

    const tick = () => new Promise(resolve => setImmediate(resolve));

    // jsdom has no CSS transitions, so when an element's classes change, which is how the
    // runtime starts them (e.g. fading out text that {{#replace}} replaces), it's told the
    // transition has ended a moment later
    const transitioning = new WeakSet<Node>();
    const observer = new window.MutationObserver(records => {
        for (const record of records) {
            const target = record.target;
            if (transitioning.has(target)) continue;
            transitioning.add(target);
            g.setTimeout(() => {
                transitioning.delete(target);
                target.dispatchEvent(new window.Event("transitionend", { bubbles: true }));
            }, TRANSITION_TIME);
        }
    });
    observer.observe(window.document, { attributes: true, attributeFilter: ["class"], subtree: true });

    return {
        async settle(action, waitingForPlayer) {
            let done = !action;
            let error: unknown;
            action?.then(() => { done = true; }, e => { done = true; error = e; });
            let quiet = 0;
            let timers = 0;
            let everyTicks = 0;
            let frameCount = 0;
            const started = realDateNow();
            for (;;) {
                await tick();
                if (pending.size) {
                    quiet = 0;
                    continue;
                }
                // The next animation frame, unless it's an animation that never ends. Waiting for
                // the player to click a continue, only a few frames are needed: anything else
                // happening then is just for show.
                if (frames.size && frameCount < (waitingForPlayer?.() ? 10 : MAX_FRAMES)) {
                    frameCount++;
                    skipped += FRAME_TIME;
                    const due = [...frames.values()];
                    frames.clear();
                    for (const fn of due) run(fn as (...args: unknown[]) => void, [virtualPerformanceNow()]);
                    quiet = 0;
                    continue;
                }
                if (++quiet < 2) continue;
                // Nothing's happening, so it's time for the next timer, if there is one
                if (later.length) {
                    if (everyTicks >= MAX_EVERY_TICKS && (done || waitingForPlayer?.()) && later.every(t => isEveryTick(t.fn))) {
                        return { error, stillGoing: false, repeating: true };
                    }
                    if (timers >= MAX_TIMERS) return { error, stillGoing: true };
                    later.sort((a, b) => a.due - b.due || a.id - b.id);
                    const next = later.shift()!;
                    everyTicks = isEveryTick(next.fn) ? everyTicks + 1 : 0;
                    skipped = Math.max(skipped, next.due);
                    timers++;
                    frameCount = 0;
                    run(next.fn, next.args);
                    quiet = 0;
                    continue;
                }
                if (done || waitingForPlayer?.()) return { error, stillGoing: false };
                // Waiting for something else
                if (realDateNow() - started > MAX_REAL_WAIT) return { error, stillGoing: true };
                await new Promise(resolve => realSetTimeout(resolve, 20));
            }
        },
        takeMessages() {
            const result = { errors: errors.splice(0), console: consoleLines.splice(0) };
            return result;
        },
        seed(seed) {
            Math.random = seed === undefined ? originalRandom : seededRandom(seed);
        },
        close() {
            observer.disconnect();
            for (const handle of pending) realClearTimeout(handle as ReturnType<typeof setTimeout>);
            g.setTimeout = realSetTimeout;
            g.clearTimeout = realClearTimeout;
            performance.now = realPerformanceNow;
            Date.now = realDateNow;
            if (activeFrames == frames) activeFrames = undefined;
            Math.random = originalRandom;
            Object.assign(console, originalConsole);
            process.off("unhandledRejection", onRejection);
            for (const key of added) delete g[key];
            window.close();
        },
    };
}

// ---- What's on the screen, as text ----

export interface PlayChoice {
    // 1-based, for --choose
    number: number;
    text: string;
    // Where it goes, for a link to a section or passage
    section?: string;
    passage?: string;
    // Can't be clicked until the text boxes in the section are filled in properly
    needsInput?: boolean;
    // Text the player clicks to carry on, from {{#animate "continue"}}
    continue?: boolean;
}

const BLOCK_ELEMENTS = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER",
    "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE",
    "TR", "UL",
]);

// Not shown, or only there for screen readers, such as the copy of the text Anime.js keeps
// when it splits text into letters to animate them
const isHidden = (element: Element) => {
    if (element.hasAttribute("hidden")) return true;
    const style = (element as HTMLElement).style;
    if (!style) return false;
    return style.display == "none" || style.clipPath == "inset(50%)" || /^rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)$/.test(style.clip);
};

// An element's text as the player would read it. Links that can be clicked are in [brackets].
function renderText(root: Element, clickable: Set<Element>): string {
    const out: string[] = [];
    const walk = (node: Node) => {
        if (node.nodeType == 3) {
            out.push((node.textContent ?? "").replace(/\s+/g, " "));
            return;
        }
        if (node.nodeType != 1) return;
        const element = node as Element;
        const tag = element.tagName;
        if (tag == "SCRIPT" || tag == "STYLE" || tag == "TEMPLATE" || isHidden(element)) return;
        if (element.classList.contains("squiffy-error")) {
            out.push("\n" + "ERROR: " + (element.textContent ?? "").trim() + "\n");
            return;
        }
        if (tag == "BR") {
            out.push("\n");
            return;
        }
        if (tag == "IMG") {
            out.push(`[image: ${element.getAttribute("alt") || element.getAttribute("src") || ""}]`);
            return;
        }
        const attribute = element.getAttribute("data-attribute") || element.id;
        if (tag == "INPUT" || tag == "TEXTAREA") {
            const value = (element as HTMLInputElement).value;
            // A text box that goes somewhere when Enter is pressed (#454) is one of the choices
            const enter = clickable.has(element) ? ", Enter to go on" : "";
            out.push(`[${inputKind(element)}${attribute ? ` for ${attribute}` : ""}${value ? `: "${value}"` : ""}${enter}]`);
            return;
        }
        if (tag == "SELECT") {
            const options = [...element.querySelectorAll("option")].map(o => o.textContent?.trim()).join(" / ");
            out.push(`[choice${attribute ? ` for ${attribute}` : ""}: ${options}]`);
            return;
        }
        if (element.hasAttribute("contenteditable") && element.getAttribute("contenteditable") != "false") {
            out.push(`[editable text${attribute ? ` for ${attribute}` : ""}: "${(element.textContent ?? "").trim()}"]`);
            return;
        }
        if (clickable.has(element)) {
            out.push("[" + linkText(element) + "]");
            return;
        }
        const block = BLOCK_ELEMENTS.has(tag);
        if (block) out.push("\n");
        if (tag == "LI") out.push("- ");
        for (const child of element.childNodes) walk(child);
        if (block) out.push(tag == "P" ? "\n\n" : "\n");
    };
    walk(root);
    return tidy(out.join(""));
}

// What kind of text box, checkbox or the like an input is
function inputKind(element: Element): string {
    if (element.tagName == "TEXTAREA") return "text box";
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    return type == "checkbox" ? "checkbox" : type == "radio" ? "radio button" : `${type == "text" ? "text" : type} box`;
}

// A link's text, on one line. For a text box that goes somewhere when Enter is pressed (#454),
// what the player does.
const linkText = (element: Element) => {
    if (element.tagName == "INPUT") {
        const attribute = element.getAttribute("data-attribute") || element.id;
        return `Press Enter in the ${inputKind(element)}${attribute ? ` for ${attribute}` : ""}`;
    }
    return renderText(element, new Set()).replace(/\s+/g, " ");
};

// Whether a link can't be clicked until the text boxes in its section are filled in properly.
// A text box that goes somewhere when Enter is pressed (#454) waits for them too.
function needsInput(link: Element): boolean {
    if (link.classList.contains("validation-disabled")) return true;
    if (link.tagName != "INPUT") return false;
    const section = link.closest(".squiffy-output-section");
    const inputs = section?.querySelectorAll<HTMLInputElement>("input:not([disabled]), textarea:not([disabled]), select:not([disabled])") ?? [];
    return [...inputs].some(input => !input.checkValidity());
}

// One space between words, no spaces at the ends of lines, and at most one blank line in a row
const tidy = (text: string) => text
    .split("\n").map(line => line.replace(/ +/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// ---- Playing ----

export interface PlayStep {
    // The link clicked, or undefined for the start of the story
    choice?: string;
    // The sections and passages shown, in order
    went: { section: string; passage?: string }[];
    // Whether the screen was cleared before the text
    cleared: boolean;
    // The new text on the screen
    text: string;
    errors: string[];
    console: string[];
    // The story was still moving on by itself, e.g. with {{goto ... after=}} in a loop, when
    // play stopped waiting for it
    stillGoing?: boolean;
    // Some text was still being shown again and again by an {{#every}} (#451) when play stopped
    // waiting for it
    repeating?: boolean;
    // The story's attributes after this step, with stepAttributes, apart from internal ones
    // starting with "_"
    attributes?: Record<string, unknown>;
}

export interface PlayOptions {
    // The section to start at, instead of the story's start or the saved game
    start?: string;
    // The links to click, in order: their text, or their number in the list of choices
    choose?: string[];
    // Text to put in the text boxes, by attribute, when they're on the screen
    inputs?: Record<string, string>;
    // A saved game to carry on from
    save?: PlaySave;
    // Makes the story's randomness the same every time
    seed?: number;
    // Gives each step the story's attributes after it, for playthrough tests (--record, --test)
    stepAttributes?: boolean;
}

export type SectionLabels = Record<string, string>;

// The labels for the sections named, for those without names of their own
function labelsFor(playable: PlayableStory, names: Iterable<string>): { sectionLabels?: SectionLabels } {
    const labels: SectionLabels = {};
    for (const name of names) {
        const label = playable.labels.get(name);
        if (label) labels[name] = label;
    }
    return Object.keys(labels).length ? { sectionLabels: labels } : {};
}

export interface PlayResult {
    // False if there were any errors, or a link to click couldn't be found
    success: boolean;
    steps: PlayStep[];
    // The section the player is in at the end
    section: string;
    // Whether that section is marked @end
    ending: boolean;
    // What the player can click now
    choices: PlayChoice[];
    // The story's attributes, apart from internal ones starting with "_"
    attributes: Record<string, unknown>;
    // Why play stopped early, e.g. a link that couldn't be found
    stopped?: string;
    notes: string[];
    // The game as it is at the end, to carry on from
    save: PlaySave;
    // What to call the sections in the result without names of their own, by name
    sectionLabels?: SectionLabels;
}

// A saved game, as --save keeps it, with the story's persistent attributes (#539), which aren't
// part of a saved game, so the next run starts with them as they were
export type PlaySave = SavedGame & { persistent?: Record<string, unknown> };

// A story being played, and what's been shown of it so far
class Session {
    private readonly element: HTMLElement;
    private readonly seen = new WeakSet<Element>();
    private clears = 0;
    private went: { section: string; passage?: string }[] = [];
    private filled = new WeakSet<Element>();

    private constructor(readonly api: SquiffyApi, element: HTMLElement, private readonly env: Environment, private readonly sections: Set<string>) {
        this.element = element;
        // A section is recorded when it starts, as it may have animations or a continue to get
        // through before it's finished, and a passage when it's shown
        api.on("set", e => {
            if (e.attribute == "_section" && typeof e.value == "string") this.went.push({ section: e.value });
        });
        api.on("navigated", e => {
            if (e.passage !== undefined) this.went.push({ section: e.section, passage: e.passage });
        });
    }

    // Persistent attributes start empty, unless they're given, e.g. from --save
    static async create(playable: PlayableStory, env: Environment, persistent?: Record<string, unknown>) {
        const { init } = await import("squiffy-runtime");
        const element = document.createElement("div");
        document.body.replaceChildren(element);
        const api = await init({ element, story: playable.story, persist: false, scroll: "element", persistent });
        return new Session(api, element, env, new Set(Object.keys(playable.story.sections)));
    }

    private get output() {
        return this.element.firstElementChild as HTMLElement;
    }

    private currentSection(): HTMLElement | undefined {
        const sections = [...this.output.children].filter(c => c.classList.contains("squiffy-output-section"));
        return sections[sections.length - 1] as HTMLElement | undefined;
    }

    // The links the player can click, and the text boxes that go somewhere when Enter is
    // pressed (#454). While there's {{#animate "continue"}} text to click to see what comes next,
    // that's all the player can click. {{restart}}, {{saves}} and {{settings}} links are left out:
    // like the page's own buttons, they're not choices in the story, and they open dialogs.
    private clickableLinks(): HTMLElement[] {
        const section = this.currentSection();
        if (!section) return [];
        const continues = [...section.querySelectorAll<HTMLElement>(".squiffy-continue")];
        if (continues.length) return continues.slice(0, 1);
        return [...section.querySelectorAll<HTMLElement>("a.squiffy-link:not(.disabled), input[data-section]:not([disabled]), input[data-passage]:not([disabled])")]
            .filter(link => !link.closest("[hidden]") && !PAGE_LINKS.has(link.getAttribute("data-handler") ?? ""));
    }

    private waitingForContinue = () => !!this.currentSection()?.querySelector(".squiffy-continue");

    // Clicks a link, or a continue
    click(link: HTMLElement): Promise<unknown> {
        if (link.classList.contains("squiffy-continue")) {
            link.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
            return Promise.resolve();
        }
        return this.api.clickLink(link);
    }

    async settle() {
        await this.env.settle(undefined, this.waitingForContinue);
    }

    choices(): PlayChoice[] {
        return this.clickableLinks().map((link, i) => {
            const section = link.getAttribute("data-section");
            const passage = link.getAttribute("data-passage");
            return {
                number: i + 1,
                text: linkText(link),
                ...(section ? { section } : {}),
                ...(passage ? { passage } : {}),
                ...(needsInput(link) ? { needsInput: true } : {}),
                ...(link.classList.contains("squiffy-continue") ? { continue: true } : {}),
            };
        });
    }

    // Runs something the player does, and returns what it put on the screen
    async step(choice: string | undefined, action: () => Promise<unknown>, link?: HTMLElement): Promise<PlayStep> {
        this.went = [];
        const { error, stillGoing, repeating } = await this.env.settle(action(), this.waitingForContinue);
        const messages = this.env.takeMessages();
        if (error) messages.errors.push(formatError(error));
        // The runtime does nothing when a link goes to a section that doesn't exist
        const target = link?.getAttribute("data-section");
        if (target && !this.sections.has(target)) {
            messages.errors.push(`There's no section called "${target}", so the link "${choice}" does nothing.`);
        }

        const clearStack = this.output.querySelector(".squiffy-clear-stack");
        const clears = clearStack?.children.length ?? 0;
        const cleared = clears > this.clears;
        this.clears = clears;

        const clickable = new Set<Element>(this.clickableLinks());
        const parts: string[] = [];
        for (const block of this.output.querySelectorAll(".squiffy-output-block")) {
            if (this.seen.has(block) || clearStack?.contains(block)) continue;
            this.seen.add(block);
            const text = renderText(block, clickable);
            if (text) parts.push(text);
        }
        // Errors are in the text where they appeared, and listed here too, including any shown
        // outside the text, such as from a {{goto}} loop
        const errors = [
            ...[...this.output.querySelectorAll(".squiffy-error")]
                .filter(e => !this.seen.has(e) && !clearStack?.contains(e))
                .map(e => {
                    this.seen.add(e);
                    return (e.textContent ?? "").trim();
                }),
            ...messages.errors,
        ];
        // A link that changes what it says when it's clicked, such as {{rotate}}
        if (link?.isConnected && !parts.length) {
            const now = linkText(link);
            if (now != choice) parts.push(`(The link now says "${now}".)`);
        }
        return {
            ...(choice !== undefined ? { choice } : {}),
            went: this.went,
            cleared,
            text: parts.join("\n\n"),
            errors: dedupe(errors),
            console: messages.console,
            ...(stillGoing ? { stillGoing } : {}),
            ...(repeating ? { repeating } : {}),
        };
    }

    // The text of the section on the screen now, e.g. after loading a saved game
    currentText() {
        const section = this.currentSection();
        if (!section) return "";
        for (const element of this.output.querySelectorAll(".squiffy-output-block, .squiffy-error")) this.seen.add(element);
        this.clears = this.output.querySelector(".squiffy-clear-stack")?.children.length ?? 0;
        return renderText(section, new Set(this.clickableLinks()));
    }

    // Finds a link by its text, or its number
    findLink(choice: string): HTMLElement | undefined {
        const links = this.clickableLinks();
        const text = (link: HTMLElement) => linkText(link).toLowerCase();
        const wanted = choice.replace(/\s+/g, " ").trim().toLowerCase();
        const byText = links.find(link => text(link) == wanted);
        if (byText) return byText;
        if (/^\d+$/.test(wanted)) return links[Number(wanted) - 1];
        return undefined;
    }

    // Puts text in the text boxes on the screen. With random, any left empty get something that
    // satisfies their validation, if possible, for --random. With again, those already filled in
    // are filled in again, if the inputs have something for them (--play --interactive's :input).
    fillInputs(inputs: Record<string, string>, random?: () => number, again = false): { attribute: string; value: string }[] {
        const section = this.currentSection();
        if (!section) return [];
        const result: { attribute: string; value: string }[] = [];
        for (const input of section.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([disabled]), textarea:not([disabled]), select:not([disabled])")) {
            const attribute = input.getAttribute("data-attribute") || input.id;
            if (this.filled.has(input) && !(again && attribute && attribute in inputs)) continue;
            let value: string | undefined = attribute ? inputs[attribute] : undefined;
            if (value === undefined && random) value = makeUpValue(input, random);
            if (value === undefined) continue;
            this.filled.add(input);
            if (input instanceof window.HTMLInputElement && (input.type == "checkbox" || input.type == "radio")) {
                input.checked = !["", "false", "0", "no"].includes(value.toLowerCase());
            }
            else {
                input.value = value;
            }
            input.dispatchEvent(new window.Event("input", { bubbles: true }));
            input.dispatchEvent(new window.Event("change", { bubbles: true }));
            if (attribute) result.push({ attribute, value });
        }
        return result;
    }

    // The attributes include persistent ones (#539)
    attributes(): Record<string, unknown> {
        const state = { ...this.api.getSave().state, ...this.api.getPersistent() };
        return Object.fromEntries(Object.entries(state).filter(([name]) => !name.startsWith("_")));
    }

    save(): PlaySave {
        const persistent = this.api.getPersistent();
        return { ...this.api.getSave(), ...(Object.keys(persistent).length ? { persistent } : {}) };
    }

    dispose() {
        this.api.dispose();
    }
}

const dedupe = (items: string[]) => [...new Set(items)];

// Something to put in an empty text box, for --random
function makeUpValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, random: () => number): string | undefined {
    if (input instanceof window.HTMLSelectElement) {
        const options = [...input.options].filter(o => !o.disabled && o.value);
        return options.length ? options[Math.floor(random() * options.length)].value : undefined;
    }
    if (input.value) return undefined;
    const type = (input.getAttribute("type") ?? "text").toLowerCase();
    if (type == "checkbox" || type == "radio") return random() < 0.5 ? "true" : "false";
    if (type == "number" || type == "range") return input.getAttribute("min") ?? "1";
    if (type == "email") return "player@example.com";
    if (type == "url") return "https://example.com";
    const min = Number(input.getAttribute("minlength") || 0);
    return "Sam".padEnd(Math.max(3, min), "m");
}

const sectionExists = (playable: PlayableStory, section: string) => section in playable.story.sections;

// What the player can do at a point in the story, and what they've done so far
export interface PlayState {
    // The section the player is in
    section: string;
    // Whether that section is marked @end
    ending: boolean;
    // What the player can click now
    choices: PlayChoice[];
    // The story's attributes, apart from internal ones starting with "_"
    attributes: Record<string, unknown>;
    // The game as it is, to carry on from
    save: PlaySave;
}

export interface PlayerOptions extends Omit<PlayOptions, "choose"> {
    // How to tell the player to fill in a text box: "--input", or ":input" for --interactive
    inputHint?: string;
}

// A story being played a step at a time, in one jsdom environment: what --play uses to click
// its links in order, and --play --interactive to click each link as it's read (#530)
export class StoryPlayer {
    readonly notes: string[] = [];
    private readonly inputs: Record<string, string>;

    private constructor(
        private readonly playable: PlayableStory,
        private readonly env: Environment,
        private readonly session: Session,
        private readonly options: PlayerOptions,
    ) {
        this.inputs = { ...options.inputs };
        if (playable.scripts.length) {
            this.notes.push(`The story's script files (${playable.scripts.join(", ")}) aren't run when playing from the command line.`);
        }
    }

    // Starts the story, at options.start or from options.save if given, and returns what it
    // showed first, or why it couldn't start. The player must be closed afterwards.
    static async open(playable: PlayableStory, options: PlayerOptions = {}): Promise<{ player: StoryPlayer; step?: PlayStep; stopped?: string }> {
        const env = await createEnvironment();
        env.seed(options.seed);
        let session: Session;
        try {
            session = await Session.create(playable, env, options.save?.persistent);
        }
        catch (e) {
            env.close();
            throw e;
        }
        const player = new StoryPlayer(playable, env, session, options);
        const s = session;
        let step: PlayStep | undefined;
        let stopped: string | undefined;
        try {
            if (options.start !== undefined && !sectionExists(playable, options.start)) {
                stopped = `There's no section called "${options.start}".`;
                await env.settle(s.api.begin());
            }
            else if (options.start !== undefined) {
                step = player.withAttributes(await s.step(undefined, () => s.api.begin({ section: options.start! })));
            }
            else if (options.save) {
                const loaded = await s.api.loadSave(options.save);
                if (!loaded.success) {
                    stopped = loaded.error == "wrongStory"
                        ? "The saved game is from a different story."
                        : "The saved game couldn't be loaded.";
                }
                else {
                    await s.settle();
                    const errors = env.takeMessages();
                    step = player.withAttributes({
                        went: [{ section: s.api.get("_section") }], cleared: false, text: s.currentText(),
                        errors: errors.errors, console: errors.console,
                    });
                }
            }
            else {
                step = player.withAttributes(await s.step(undefined, () => s.api.begin()));
            }
            await player.fillInputs();
        }
        catch (e) {
            player.close();
            throw e;
        }
        return { player, ...(step ? { step } : {}), ...(stopped ? { stopped } : {}) };
    }

    // Attributes are taken once a step has finished. Text boxes are filled in after that, just
    // before the next link is clicked, so what they set is in the next step.
    private withAttributes(step: PlayStep): PlayStep {
        if (this.options.stepAttributes) step.attributes = structuredClone(this.session.attributes());
        return step;
    }

    private async fillInputs(inputs = this.inputs, again = false) {
        this.session.fillInputs(inputs, undefined, again);
        await this.session.settle();
    }

    // Clicks a link, by its text or its number in the list of choices, and returns what it
    // showed, or why it couldn't be clicked
    async choose(choice: string): Promise<{ step?: PlayStep; stopped?: string }> {
        const s = this.session;
        const link = s.findLink(choice);
        if (!link) {
            const choices = s.choices();
            return {
                stopped: choices.length
                    ? `There's no link "${choice}" to click. The links are: ${choices.map(c => `"${c.text}"`).join(", ")}.`
                    : `There's no link "${choice}" to click, as there are no links to click.`,
            };
        }
        if (needsInput(link)) {
            return { stopped: `The link "${choice}" can't be clicked until the text boxes are filled in properly. Use ${this.options.inputHint ?? "--input"} to fill them in.` };
        }
        const text = linkText(link);
        const step = this.withAttributes(await s.step(text, () => s.click(link), link));
        await this.fillInputs();
        return { step };
    }

    // Puts text in text boxes, by attribute: those on the screen now, even if they've been
    // filled in already, and any shown later
    async setInputs(inputs: Record<string, string>) {
        Object.assign(this.inputs, inputs);
        await this.fillInputs(inputs, true);
    }

    get currentInputs(): Record<string, string> {
        return { ...this.inputs };
    }

    state(): PlayState {
        const section = this.session.api.get("_section") ?? "";
        return {
            section,
            ending: this.playable.endings.has(section),
            choices: this.session.choices(),
            attributes: this.session.attributes(),
            save: this.session.save(),
        };
    }

    // What to call the sections without names of their own, in these steps and the state
    labels(steps: PlayStep[], state: PlayState) {
        return labelsFor(this.playable, [
            state.section, ...steps.flatMap(step => step.went.map(w => w.section)),
            ...state.choices.flatMap(c => c.section ? [c.section] : []),
        ]);
    }

    close() {
        this.session.dispose();
        this.env.close();
    }
}

export async function playStory(playable: PlayableStory, options: PlayOptions = {}): Promise<PlayResult> {
    const { choose = [], ...rest } = options;
    const opened = await StoryPlayer.open(playable, rest);
    const player = opened.player;
    try {
        const steps: PlayStep[] = opened.step ? [opened.step] : [];
        let stopped = opened.stopped;
        for (const choice of stopped ? [] : choose) {
            const chosen = await player.choose(choice);
            if (chosen.step) steps.push(chosen.step);
            if (chosen.stopped) {
                stopped = chosen.stopped;
                break;
            }
        }
        const state = player.state();
        return {
            success: !stopped && !steps.some(step => step.errors.length),
            steps,
            section: state.section,
            ending: state.ending,
            choices: state.choices,
            attributes: state.attributes,
            ...(stopped ? { stopped } : {}),
            notes: player.notes,
            save: state.save,
            ...player.labels(steps, state),
        };
    }
    finally {
        player.close();
    }
}

// ---- Playing at random ----

export interface RandomOptions {
    runs: number;
    // The most links to click in one run
    steps: number;
    seed: number;
    start?: string;
}

// Something that went wrong, with how to get back to it
export interface RandomProblem {
    kind: "error" | "dead-end" | "stuck";
    section: string;
    message: string;
    // How many times it happened
    count: number;
    // The shortest way found to it: the --seed and the --input and --choose options for --play
    seed: number;
    inputs: { attribute: string; value: string }[];
    choices: string[];
}

export interface RandomResult {
    success: boolean;
    runs: number;
    steps: number;
    seed: number;
    problems: RandomProblem[];
    // How many times each ending was reached
    endings: Record<string, number>;
    // Runs that clicked as many links as they could without reaching an ending or a dead end
    outOfSteps: number;
    sections: { total: number; visited: number; notVisited: string[] };
    passages: { total: number; visited: number; notVisited: string[] };
    notes: string[];
    // What to call the sections in the result without names of their own, by name
    sectionLabels?: SectionLabels;
}

export async function playRandom(playable: PlayableStory, options: RandomOptions): Promise<RandomResult> {
    const env = await createEnvironment();
    const problems = new Map<string, RandomProblem>();
    const endings: Record<string, number> = {};
    const visitedSections = new Set<string>();
    const visitedPassages = new Set<string>();
    let outOfSteps = 0;
    const notes: string[] = [];
    if (playable.scripts.length) {
        notes.push(`The story's script files (${playable.scripts.join(", ")}) aren't run when playing from the command line.`);
    }
    if (options.start !== undefined && !sectionExists(playable, options.start)) {
        env.close();
        throw new Error(`There's no section called "${options.start}".`);
    }

    const report = (problem: Omit<RandomProblem, "count">) => {
        const key = `${problem.kind}\n${problem.section}\n${problem.message}`;
        const existing = problems.get(key);
        if (!existing) {
            problems.set(key, { ...problem, count: 1 });
            return;
        }
        existing.count++;
        if (problem.choices.length < existing.choices.length) {
            Object.assign(existing, { seed: problem.seed, inputs: problem.inputs, choices: problem.choices });
        }
    };

    try {
        for (let run = 0; run < options.runs; run++) {
            const runSeed = (options.seed + run) >>> 0;
            env.seed(runSeed);
            const pick = seededRandom(runSeed ^ 0x5bd1e995);
            const session = await Session.create(playable, env);
            const choices: string[] = [];
            const inputs: { attribute: string; value: string }[] = [];
            const visit = (step: PlayStep) => {
                for (const place of step.went) {
                    visitedSections.add(place.section);
                    if (place.passage !== undefined) {
                        // A passage that isn't in the section is one of the master section's,
                        // which can be shown from any section
                        const own = Object.prototype.hasOwnProperty.call(playable.story.sections[place.section]?.passages ?? {}, place.passage);
                        visitedPassages.add(`${own ? place.section : ""}/${place.passage}`);
                    }
                }
                const section = session.api.get("_section") ?? "";
                for (const message of step.errors) {
                    report({ kind: "error", section, message, seed: runSeed, inputs: [...inputs], choices: [...choices] });
                }
                return !step.stillGoing;
            };
            try {
                const start = await session.step(undefined, () => session.api.begin(options.start !== undefined ? { section: options.start } : undefined));
                let carryOn = visit(start);
                let clicks = 0;
                while (carryOn) {
                    inputs.push(...session.fillInputs({}, pick));
                    await session.settle();
                    const available = session.choices();
                    const section = session.api.get("_section") ?? "";
                    const clickable = available.filter(c => !c.needsInput);
                    if (!clickable.length) {
                        if (playable.endings.has(section)) {
                            endings[section] = (endings[section] ?? 0) + 1;
                        }
                        else if (available.length) {
                            report({
                                kind: "stuck", section, seed: runSeed, inputs: [...inputs], choices: [...choices],
                                message: "The links can't be clicked, as the text boxes couldn't be filled in to satisfy their validation.",
                            });
                        }
                        else {
                            report({
                                kind: "dead-end", section, seed: runSeed, inputs: [...inputs], choices: [...choices],
                                message: "There are no links to click, and the section isn't marked @end.",
                            });
                        }
                        break;
                    }
                    if (clicks++ >= options.steps) {
                        outOfSteps++;
                        break;
                    }
                    const choice = clickable[Math.floor(pick() * clickable.length)];
                    // The text finds the link, unless another link has the same text, or it
                    // could be taken for a number, or a comment in a choices file
                    const unique = available.filter(c => c.text.toLowerCase() == choice.text.toLowerCase()).length == 1
                        && !/^\d+$/.test(choice.text) && !choice.text.startsWith("#");
                    choices.push(unique ? choice.text : String(choice.number));
                    const link = session.findLink(choices[choices.length - 1])!;
                    carryOn = visit(await session.step(choice.text, () => session.click(link), link));
                }
            }
            finally {
                session.dispose();
            }
        }
    }
    finally {
        env.close();
    }

    const sections = playable.sections;
    const notVisitedSections = sections.filter(s => !visitedSections.has(s));
    const notVisitedPassages = playable.passages.filter(p => !visitedPassages.has(p));
    const sorted = [...problems.values()].sort((a, b) =>
        (a.kind == "error" ? 0 : 1) - (b.kind == "error" ? 0 : 1) || b.count - a.count);
    return {
        success: sorted.length == 0,
        runs: options.runs,
        steps: options.steps,
        seed: options.seed,
        problems: sorted,
        endings,
        outOfSteps,
        sections: { total: sections.length, visited: sections.length - notVisitedSections.length, notVisited: notVisitedSections },
        passages: { total: playable.passages.length, visited: playable.passages.length - notVisitedPassages.length, notVisited: notVisitedPassages },
        notes,
        ...labelsFor(playable, [
            ...sorted.map(p => p.section), ...Object.keys(endings), ...notVisitedSections,
            ...notVisitedPassages.map(p => passageParts(p).section),
        ]),
    };
}

// ---- Formatting ----

// A section, in a sentence: 'section "cave"', or for a section without a name of its own, what
// it starts with, e.g. 'the "+++Continue..." after "cave"'
const describeSection = (section: string, labels?: SectionLabels) => labels?.[section] ?? `section "${section}"`;
// A section in a list
const listSection = (section: string, labels?: SectionLabels) => labels?.[section] ?? `"${section}"`;

// A passage as PlayableStory.passages has it, "section/passage". The names the compiler gives
// sections have no "/" in them.
function passageParts(passage: string) {
    const slash = passage.indexOf("/");
    return { section: passage.slice(0, slash), passage: passage.slice(slash + 1) };
}

const listPassage = (passage: string, labels?: SectionLabels) => {
    const parts = passageParts(passage);
    const label = labels?.[parts.section];
    return label ? `"${parts.passage}" in ${label}` : `"${passage}"`;
};

const quote = (text: string) => /^[\w.,/@%+=:-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`;

// The command line options that play the story to where a problem happened. With a choices
// file, which has the links to click in it, it's given instead of --choose for each one.
export function reproduceOptions(problem: Pick<RandomProblem, "seed" | "inputs" | "choices">, start?: string, choicesFile?: string): string {
    const parts = ["--play", "--seed", String(problem.seed)];
    if (start !== undefined) parts.push("--start", quote(start));
    const inputs = new Map(problem.inputs.map(i => [i.attribute, i.value]));
    for (const [attribute, value] of inputs) parts.push("--input", quote(`${attribute}=${value}`));
    if (choicesFile !== undefined) parts.push("--choices", quote(choicesFile));
    else for (const choice of problem.choices) parts.push("--choose", quote(choice));
    return parts.join(" ");
}

// A problem is given a choices file when there are more links than this to click to get to it,
// to keep the command line short
export const MAX_INLINE_CHOICES = 5;

// A choices file, for --choices: the links to click, one on each line. Blank lines, and
// lines starting with "# ", are left out.
export function formatChoicesFile(choices: string[], comments: string[] = []): string {
    return [...comments.map(c => `# ${c}`), ...choices].join("\n") + "\n";
}

export function parseChoicesFile(text: string): string[] {
    return text.split(/\r?\n/).map(line => line.trim()).filter(line => line && line != "#" && !line.startsWith("# "));
}

// What a problem's choices file says about it
export const problemComments = (problem: RandomProblem, labels?: SectionLabels) => [
    `${problem.kind == "error" ? "Error" : problem.kind == "dead-end" ? "Dead end" : "Stuck"} in ${describeSection(problem.section, labels)}: ${problem.message}`,
    "The links to click to get there, for --choices",
];

const describePlace = (place: { section: string; passage?: string }, labels?: SectionLabels) =>
    place.passage !== undefined ? `passage "${place.passage}" in ${describeSection(place.section, labels)}` : describeSection(place.section, labels);

// The places a step went, with the same place several times in a row only once
function describePlaces(places: { section: string; passage?: string }[], labels?: SectionLabels) {
    const runs: { place: string; count: number }[] = [];
    for (const place of places.map(p => describePlace(p, labels))) {
        const last = runs[runs.length - 1];
        if (last?.place == place) last.count++;
        else runs.push({ place, count: 1 });
    }
    return runs.map(r => r.count > 1 ? `${r.place} ${r.count} times` : r.place).join(", then ");
}

export function formatPlayResult(result: PlayResult, showAttributes: boolean, inputHint = "--input"): string {
    const labels = result.sectionLabels;
    const lines: string[] = [];
    for (const note of result.notes) lines.push(`(${note})`);
    for (const step of result.steps) {
        if (lines.length) lines.push("");
        if (step.choice !== undefined) lines.push(`> ${step.choice}`);
        if (step.went.length) lines.push(`(${describePlaces(step.went, labels)})`);
        if (step.cleared) lines.push("(The screen is cleared.)");
        if (step.text) lines.push("", step.text);
        // Errors are already in the text, where they appeared, unless they came from elsewhere
        for (const error of step.errors) {
            if (!step.text.includes(error)) lines.push(`ERROR: ${error}`);
        }
        for (const line of step.console) lines.push(line);
        if (step.stillGoing) lines.push("(The story is still moving on by itself, so play stopped waiting for it here.)");
        if (step.repeating) lines.push("(Some text is still being shown again and again, with {{#every}}, so play stopped waiting for it here.)");
    }
    lines.push("");
    if (result.stopped) {
        lines.push(`Stopped: ${result.stopped}`);
    }
    if (result.choices.length) {
        lines.push(`Choices (in ${describeSection(result.section, labels)}):`);
        for (const choice of result.choices) {
            const where = choice.section ? ` -> ${describeSection(choice.section, labels)}` : choice.passage ? ` -> passage "${choice.passage}"` : choice.continue ? " (continue)" : "";
            lines.push(`  ${choice.number}. ${choice.text}${where}${choice.needsInput ? ` (needs the text boxes filling in: use ${inputHint})` : ""}`);
        }
    }
    else if (result.ending) {
        lines.push(`The end: ${describeSection(result.section, labels)} is one of the story's endings.`);
    }
    else {
        lines.push(`No links to click in ${describeSection(result.section, labels)}, and it isn't marked @end.`);
    }
    if (showAttributes) {
        lines.push("", "Attributes:");
        for (const [name, value] of Object.entries(result.attributes)) lines.push(`  ${name} = ${JSON.stringify(value)}`);
    }
    return lines.join("\n");
}

// choicesFiles: the choices file for each problem that has one, by its index in result.problems
export function formatRandomResult(result: RandomResult, start?: string, choicesFiles: (string | undefined)[] = []): string {
    const labels = result.sectionLabels;
    const lines: string[] = [];
    for (const note of result.notes) lines.push(`(${note})`);
    lines.push(`Played ${result.runs} time${result.runs == 1 ? "" : "s"}, clicking up to ${result.steps} links at random each time (--seed ${result.seed}).`);
    lines.push("");
    lines.push(`Sections visited: ${result.sections.visited} of ${result.sections.total}`);
    if (result.sections.notVisited.length) {
        lines.push(`  Never visited: ${result.sections.notVisited.map(s => listSection(s, labels)).join(", ")}`);
    }
    lines.push(`Passages visited: ${result.passages.visited} of ${result.passages.total}`);
    if (result.passages.notVisited.length) {
        lines.push(`  Never visited: ${result.passages.notVisited.map(p => listPassage(p, labels)).join(", ")}`);
    }
    const endings = Object.entries(result.endings).sort((a, b) => b[1] - a[1]);
    lines.push(endings.length
        ? `Endings reached: ${endings.map(([name, count]) => `${listSection(name, labels)} (${count})`).join(", ")}`
        : "Endings reached: none");
    if (result.outOfSteps) {
        lines.push(`Still going after ${result.steps} clicks: ${result.outOfSteps} time${result.outOfSteps == 1 ? "" : "s"}`);
    }
    lines.push("");
    if (!result.problems.length) {
        lines.push("No problems found.");
        return lines.join("\n");
    }
    lines.push(`Problems (${result.problems.length}):`);
    for (const [i, problem] of result.problems.entries()) {
        const label = problem.kind == "error" ? "Error" : problem.kind == "dead-end" ? "Dead end" : "Stuck";
        lines.push("");
        lines.push(`${label} in ${describeSection(problem.section, labels)} (${problem.count} time${problem.count == 1 ? "" : "s"}): ${problem.message}`);
        lines.push(`  To get there: ${reproduceOptions(problem, start, choicesFiles[i])}`);
    }
    return lines.join("\n");
}

// Converts a Twine story (#378) into a Squiffy story: each passage becomes a section, and the
// passage's macros, in Harlowe or SugarCube, become Squiffy's {{...}} helpers, @set and links.
// Like the Squiffy 5 converter (v5.ts), this is a pure function with no I/O: the CLI and the
// editor write the files it returns. Anything that can't be converted is kept as a comment in
// the story and listed as a problem, so the author can deal with it by hand.

import { attributeRef, print, quote, Unconvertible } from "./expression.js";
import type { Expr } from "./expression.js";
import { convertHarlowePassage, harloweAudioPassages } from "./harlowe.js";
import { convertSugarCubePassage, convertSugarCubeWidgets, sugarCubeWidgets } from "./sugarcube.js";
import { parseTwine } from "./story.js";
import type { TwinePassage, TwineStory } from "./story.js";
import { formatProjectFile } from "../project.js";
import type { MapPositions, Panel } from "../project.js";

export interface TwineConversionProblem {
    // The Twine passage the problem is in, if it's in one
    passage?: string;
    // The Twine code that couldn't be converted
    text: string;
    reason: string;
}

export interface TwineConversionResult {
    title: string;
    // e.g. "Harlowe 3.3.9"
    format: string;
    // The story's files, by name: the .squiffy file, squiffy.json, and a CSS and JavaScript file
    // if the story has a stylesheet or JavaScript
    files: Record<string, string>;
    // The name of the main .squiffy file in files
    main: string;
    // The number of passages converted
    passages: number;
    problems: TwineConversionProblem[];
}

export interface TwineConversionOptions {
    // The base name for the files, without an extension. Defaults to "story".
    name?: string;
}

// What a format's converter gets for each passage
export interface PassageContext {
    readonly story: StoryContext;
    readonly passage: TwinePassage;
    // The Squiffy section this passage is converted into
    readonly section: string;
    // Records a problem, and returns a comment to put in the story in place of the Twine code
    unconvertible(text: string, reason: string): string;
    // Records a problem with something that's converted, but not exactly
    approximate(text: string, reason: string): void;
    // Adds a passage to this section, returning its name. The content is Squiffy text, which
    // can start with directives.
    addPassage(nameHint: string, content: ConvertedPassage | string): string;
    // Adds a passage whose content isn't known yet, so passages that link to each other can
    // be in the order they're read. Call the function returned with the content.
    reservePassage(nameHint: string): { name: string, fill: (content: ConvertedPassage | string) => void };
    // Adds a section to the story, returning its name
    addSection(nameHint: string, content: ConvertedPassage | string): string;
    // A name for a {{#label}}, unique in the story
    newLabel(hint: string): string;
}

export interface ConvertedPassage {
    // @set and other directives, which go before the text
    directives: string[];
    // Squiffy text
    body: string;
}

// The Squiffy names that would be read as a helper, rather than an attribute, in {{name}} and
// expressions, and the ones Squiffy sets itself
export const reservedAttributes = new Set([
    "get", "set", "unset", "inc", "dec", "seen", "visits", "at", "goto", "embed", "array", "random", "contains",
    "length", "append", "prepend", "pop", "remove", "section", "passage", "label", "replace", "rotate", "sequence",
    "live", "animate", "eq", "ne", "gt", "gte", "lt", "lte", "and", "or", "not", "add", "sub", "mul", "div", "mod",
    "round", "floor", "ceil", "abs", "min", "max", "upper", "lower", "capitalise", "capitalize", "cond",
    "join", "sort", "shuffle", "slice", "first", "last", "indexof", "count", "range",
    "if", "unless", "each", "with", "lookup", "log", "else", "this", "turns", "previous", "previous_section",
    "true", "false", "null", "undefined", "music", "stopmusic", "sound", "stopsounds",
    "addclass", "removeclass", "toggleclass", "hasclass",
]);

export class StoryContext {
    readonly problems: TwineConversionProblem[] = [];
    // Twine passage name -> Squiffy section name
    private readonly sectionNames = new Map<string, string>();
    private readonly usedSectionNames = new Set<string>();
    private readonly usedLabels = new Set<string>();
    // Sections added by the converter, as Squiffy text, to go at the end of the story
    readonly extraSections: string[] = [];
    private readonly permanentVars = new Set<string>();
    readonly passagesByName = new Map<string, TwinePassage>();

    constructor(readonly twine: TwineStory, passages: TwinePassage[]) {
        for (const p of passages) {
            this.passagesByName.set(p.name, p);
        }
        // Passages keep their names where they can: a name that's only taken once it's been
        // tidied up (Room [1] and Room (1)) gets a number, avoiding every other passage's name
        const wanted = passages.map(p => sanitiseName(p.name) || "Untitled");
        const counts = new Map<string, number>();
        for (const name of wanted) counts.set(name, (counts.get(name) ?? 0) + 1);
        passages.forEach((p, n) => {
            if (counts.get(wanted[n]) == 1) {
                this.sectionNames.set(p.name, wanted[n]);
                this.usedSectionNames.add(wanted[n]);
            }
        });
        // Then the passages whose names were already right, then the rest
        passages.forEach((p, n) => {
            if (!this.sectionNames.has(p.name) && p.name == wanted[n] && !this.usedSectionNames.has(p.name)) {
                this.sectionNames.set(p.name, p.name);
                this.usedSectionNames.add(p.name);
            }
        });
        for (const p of passages) {
            if (!this.sectionNames.has(p.name)) this.sectionNames.set(p.name, this.uniqueSectionName(p.name));
        }
    }

    private readonly problemKeys = new Set<string>();
    // Records a problem, once for each passage
    addProblem(problem: TwineConversionProblem) {
        const key = `${problem.passage}\u0000${problem.text}\u0000${problem.reason}`;
        if (this.problemKeys.has(key)) return;
        this.problemKeys.add(key);
        this.problems.push(problem);
    }

    notePermanentVar(name: string) {
        this.permanentVars.add(name);
    }

    // The Squiffy section for a Twine passage, or undefined if there's no such passage
    sectionFor(passageName: string): string | undefined {
        // Twine passage names can start or end with spaces, which links often leave out
        return this.sectionNames.get(passageName) ?? this.trimmedNames().get(passageName.trim());
    }

    private trimmed?: Map<string, string>;
    private trimmedNames(): Map<string, string> {
        if (!this.trimmed) {
            this.trimmed = new Map();
            for (const [name, section] of this.sectionNames) {
                if (!this.trimmed.has(name.trim())) this.trimmed.set(name.trim(), section);
            }
        }
        return this.trimmed;
    }

    private readonly cache = new Map<string, unknown>();
    // A value worked out once for the story, e.g. by a format's converter
    cached<T>(key: string, make: () => T): T {
        if (!this.cache.has(key)) this.cache.set(key, make());
        return this.cache.get(key) as T;
    }

    // Problems that are the same wherever they happen, listed once for the story, with the code
    // they happened for
    private readonly notes = new Map<string, { reason: string, texts: Set<string> }>();
    note(key: string, text: string, reason: string) {
        let note = this.notes.get(key);
        if (!note) {
            note = { reason, texts: new Set() };
            this.notes.set(key, note);
        }
        note.texts.add(text);
    }

    noteProblems(): TwineConversionProblem[] {
        return [...this.notes.values()].map(n => ({ text: [...n.texts].join(", "), reason: n.reason + "." }));
    }

    // A Squiffy section name for a passage name that isn't known (a broken link): it's
    // tidied up the same way, so the editor shows the broken link as it was meant
    sectionForUnknown(passageName: string): string {
        return this.sectionFor(passageName) ?? sanitiseName(passageName);
    }

    uniqueSectionName(hint: string): string {
        const base = sanitiseName(hint) || "Untitled";
        let name = base;
        for (let n = 2; this.usedSectionNames.has(name); n++) name = `${base} ${n}`;
        this.usedSectionNames.add(name);
        return name;
    }

    newLabel(hint: string): string {
        const base = hint.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 24) || "label";
        let name = base;
        for (let n = 2; this.usedLabels.has(name); n++) name = `${base}-${n}`;
        this.usedLabels.add(name);
        return name;
    }

    // The loops being converted to {{#each}}, innermost last, with the Twine variables (with their
    // $ or _) that stand for each one's item and position. numbers: its items are numbers, as in
    // a loop that counts. A link's body (see linkBody) is an entry with setters, and no variables.
    private readonly loops: {
        vars: Map<string, "item" | "index">, array?: string, numbers?: boolean, setters?: Map<string, string>
    }[] = [];

    inLoop<T>(vars: Map<string, "item" | "index">, array: string | undefined, convert: () => T, numbers = false): T {
        this.loops.push({ vars, array, numbers });
        try {
            return convert();
        }
        finally {
            this.loops.pop();
        }
    }

    // Converts the body of a link, which runs when it's clicked, after its loop has finished. In
    // there, the loop's item and position are attributes, which the link sets to that item's (#448).
    // Returns the setters for the link.
    linkBody<T>(convert: () => T): { result: T, setters: string[] } {
        if (!this.loops.length || this.loops[this.loops.length - 1].setters) return { result: convert(), setters: [] };
        const setters = new Map<string, string>();
        this.loops.push({ vars: new Map(), setters });
        try {
            return { result: convert(), setters: [...setters.values()] };
        }
        finally {
            this.loops.pop();
        }
    }

    private loopVariable(name: string, temporary: boolean): Expr | undefined {
        const key = (temporary ? "_" : "$") + name;
        for (let i = this.loops.length - 1; i >= 0; i--) {
            const loop = this.loops[i];
            if (loop.setters) {
                // In a link's body: the variables of the link's own loop are attributes now
                const own = this.loops[i - 1];
                const kind = own.vars.get(key);
                if (kind) {
                    const attribute = this.attributeName(name, temporary);
                    // Like a link's other setters, an item is text, unless the loop counts
                    const value = kind == "index" ? "{{@index}}" : own.numbers ? "{{this}}" : "'{{this}}'";
                    loop.setters.set(attribute, `${attribute} = ${value}`);
                    return { k: "var", name: attribute };
                }
                if (this.loops.slice(0, i - 1).some(l => l.vars.has(key))) {
                    throw new Unconvertible("a link in a loop inside another loop that uses the outer loop's item");
                }
                return undefined;
            }
            const kind = loop.vars.get(key);
            if (kind) return { k: "loop", kind, up: this.loops.length - 1 - i, array: loop.array, numbers: loop.numbers };
        }
        return undefined;
    }

    // A Twine variable's value: its attribute, or inside a loop, the loop's item or position
    variable(name: string, temporary: boolean): Expr {
        return this.loopVariable(name, temporary) ?? { k: "var", name: this.attribute(name, temporary) };
    }

    // The Squiffy attribute for a Twine variable, given without its $ or _: a temporary (_)
    // variable keeps its name unless a story variable ($) has the same name
    attribute(name: string, temporary: boolean): string {
        if (this.loopVariable(name, temporary)) throw new Unconvertible("changing a loop's variable inside the loop");
        return this.attributeName(name, temporary);
    }

    private attributeName(name: string, temporary: boolean): string {
        let result = name;
        if (temporary && this.permanentVars.has(name)) result = "temp_" + name;
        if (reservedAttributes.has(result)) result += "_";
        return result;
    }
}

const reservedSectionChars = /[[\]{}|"]/g;

// Twine allows anything in a passage name, but in Squiffy some characters would break a link,
// e.g. [[text]](a, b) sets an attribute b, and ] or | would end the link early
export function sanitiseName(name: string): string {
    let result = name
        .replace(/\[/g, "(").replace(/\]/g, ")")
        .replace(/\{/g, "(").replace(/\}/g, ")")
        .replace(reservedSectionChars, "")
        .replace(/,/g, "")
        .replace(/\s+/g, " ")
        .trim();
    // A name ending in > would be a link to the next section
    result = result.replace(/>+$/, "").trim();
    // Brackets in a link's target have to balance
    let depth = 0;
    let balanced = true;
    for (const c of result) {
        if (c == "(") depth++;
        else if (c == ")" && --depth < 0) balanced = false;
    }
    if (!balanced || depth != 0) result = result.replace(/[()]/g, "").replace(/\s+/g, " ").trim();
    // @ at the start of a passage name means something to Squiffy, so keep sections clear of it
    if (result.startsWith("@")) result = result.substring(1).trim();
    return result;
}

// Text that came from the story, made safe to put in Squiffy text: square brackets would be
// links, {{ a helper, and some characters at the start of a line mean something to the compiler
export function escapeText(text: string): string {
    return text
        .replace(/\[/g, "&#91;")
        .replace(/\]/g, "&#93;")
        .replace(/\{\{/g, "&#123;{")
        .replace(/\}\}/g, "}&#125;");
}

// A link to a section. text is Squiffy text (already escaped); target is a Squiffy section name.
export function sectionLink(text: string | null, target: string, setters: string[] = []): string {
    const linkText = text == null ? null : text.replace(/\]/g, "&#93;").replace(/\[/g, "&#91;");
    if (setters.length == 0 && (linkText == null || linkText == target) && !target.endsWith(">")) {
        return `[[${target}]]`;
    }
    return `[[${linkText ?? target}]](${[target, ...setters].join(", ")})`;
}

// A link to a web page, from a Twine link like [[https://example.com]]
export function isUrl(target: string): boolean {
    return /^(https?|mailto):/i.test(target.trim());
}

export function urlLink(text: string, url: string): string {
    const href = url.trim().replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/\[/g, "%5B").replace(/\]/g, "%5D");
    return `<a href="${href}" target="_blank">${text}</a>`;
}

// A link to a section whose name is worked out as the story runs
export function dynamicSectionLink(text: string, target: Expr, setters: string[] = []): string {
    // quote() would break the {{this}} of a loop's item
    if (setters.some(s => s.includes("{{"))) throw new Unconvertible("a link in a loop, to a passage worked out as the story runs, that sets a variable to the loop's item");
    const set = setters.length ? ` set=${quote(setters.join(", "))}` : "";
    return `{{section ${print(target)} text=${quote(text)}${set}}}`;
}

export function passageLink(text: string, target: string, setters: string[] = []): string {
    const linkText = text.replace(/\]/g, "&#93;").replace(/\[/g, "&#91;");
    return `[${linkText}](${[target, ...setters].join(", ")})`;
}

// A Squiffy setter, as in @set or a link, for name = value
export function setter(name: string, op: "=" | "+=" | "-=" | "*=" | "/=", value: Expr, inLink: boolean): string {
    return `${attributeRef(name)} ${op} ${print(value, { preferSingle: inLink, inLink })}`;
}

// A comment in the story, for Twine code that couldn't be converted. Handlebars comments can't
// contain --}}, and line breaks would let the compiler read a line of it as something else.
export function comment(text: string): string {
    const clean = text.replace(/--\}\}/g, "-- }}").replace(/\s*\n\s*/g, " ").trim();
    return `{{!-- Twine: ${clean} --}}`;
}

// SugarCube's passages for its sidebar that become panels beside the story (#443), in the order
// SugarCube shows them, with the labels of the buttons they have on a narrow screen
const sugarCubePanels: Record<string, string> = { StoryBanner: "Banner", StoryCaption: "Status" };

// Passages a format treats specially, which aren't part of the story as sections
// (StorySubtitle, StoryAuthor and so on are kept, as their text might be included elsewhere)
const sugarCubeSpecial = new Set(["StoryMenu", "StoryInterface", "StoryShare", "StoryTitle", "StoryData", "StorySettings"]);

// The problems as a text file, to keep with the converted story: the ones about the whole story,
// then each passage's, in the order of the story
export function formatTwineProblems(result: TwineConversionResult, sourceName?: string): string {
    const lines = [
        `Converted ${sourceName ?? "a Twine story"}${result.format ? ` (${result.format})` : ""} to Squiffy: ${result.passages} passage${result.passages == 1 ? "" : "s"}.`,
        "",
    ];
    if (result.problems.length == 0) {
        lines.push("Everything was converted.");
        return lines.join("\n") + "\n";
    }
    lines.push(
        `${result.problems.length} thing${result.problems.length == 1 ? "" : "s"} couldn't be converted exactly. Where something couldn't be converted at all, the story has the`,
        "Twine code in a comment, {{!-- Twine: ... --}}, so you can search for \"Twine:\" to find them.",
        "",
    );
    let passage: string | undefined = "\u0000";
    for (const p of result.problems) {
        if (p.passage !== passage) {
            passage = p.passage;
            lines.push(passage === undefined ? "The whole story:" : `${passage}:`);
        }
        lines.push(`  ${p.text}`, `    ${p.reason}`);
    }
    return lines.join("\n") + "\n";
}

export function convertTwine(source: string, options: TwineConversionOptions = {}): TwineConversionResult {
    return convertTwineStory(parseTwine(source), options);
}

export function convertTwineStory(twine: TwineStory, options: TwineConversionOptions = {}): TwineConversionResult {
    const name = options.name ?? "story";
    const harlowe = twine.format == "harlowe";
    const problems: TwineConversionProblem[] = [];
    if (twine.format == "other") {
        problems.push({
            text: twine.formatName,
            reason: `The story uses the ${twine.formatName} story format. Only Harlowe and SugarCube stories can be converted, so its passages have been converted as if it were SugarCube.`,
        });
    }

    // Passages that are part of every passage, or that run at the start, rather than sections
    const headers: TwinePassage[] = [];
    const footers: TwinePassage[] = [];
    const startup: TwinePassage[] = [];
    const widgets: TwinePassage[] = [];
    const skipped: TwinePassage[] = [];
    const panelPassages: TwinePassage[] = [];
    const storyPassages: TwinePassage[] = [];
    const seenNames = new Set<string>();
    for (const p of twine.passages) {
        if (seenNames.has(p.name)) {
            problems.push({ passage: p.name, text: p.name, reason: "There's more than one passage with this name. Only the first has been converted." });
            continue;
        }
        seenNames.add(p.name);
        if (harlowe) {
            if (p.tags.includes("header")) headers.push(p);
            else if (p.tags.includes("footer")) footers.push(p);
            else if (p.tags.includes("startup")) startup.push(p);
            else if (p.tags.some(t => t.startsWith("debug-"))) skipped.push(p);
            // The Harlowe Audio Library's tracks and settings, which are read where they're used
            else if (harloweAudioPassages.has(p.name)) continue;
            else storyPassages.push(p);
        }
        else {
            if (p.name == "PassageHeader" || p.name == "PassageReady") headers.push(p);
            else if (p.name == "PassageFooter" || p.name == "PassageDone") footers.push(p);
            else if (p.name == "StoryInit") startup.push(p);
            else if (p.tags.includes("widget")) widgets.push(p);
            else if (sugarCubeSpecial.has(p.name)) skipped.push(p);
            else if (p.name in sugarCubePanels) panelPassages.push(p);
            else {
                if (["StorySubtitle", "StoryAuthor", "StoryDisplayTitle"].includes(p.name)) {
                    problems.push({ passage: p.name, text: p.name, reason: "Squiffy has no sidebar, so this passage is an ordinary section, which nothing links to." });
                }
                storyPassages.push(p);
            }
        }
    }

    // Footers are embedded at the end of every section, so they need sections of their own
    const sectionPassages = [...storyPassages, ...footers];

    // Temporary variables keep their names unless a story variable has the same name
    const story = new StoryContext(twine, sectionPassages);
    for (const p of twine.passages) {
        for (const m of p.text.matchAll(/\$([A-Za-z_]\w*)/g)) story.notePermanentVar(m[1]);
    }

    // Widgets become sections, which calls to them embed. They're named before anything's
    // converted, so calls know where they go.
    sugarCubeWidgets(story);
    for (const p of skipped) {
        problems.push({
            passage: p.name, text: p.name,
            reason: p.name == "StoryMenu"
                ? "Squiffy has no sidebar, so this passage has been left out. Its links go to passages, which a panel can't do, but a panel can show a passage in the master section [[]] from a button in the header: see \"panels\" in squiffy.json."
                : "This special passage has been left out.",
        });
    }

    const context = (passage: TwinePassage, section: string, extraPassages: string[]): PassageContext => ({
            story,
            passage,
            section,
            unconvertible(text, reason) {
                story.addProblem({ passage: passage.name, text: oneLine(text), reason });
                return comment(text);
            },
            approximate(text, reason) {
                story.addProblem({ passage: passage.name, text: oneLine(text), reason });
            },
            addPassage(hint, content) {
                const reserved = this.reservePassage(hint);
                reserved.fill(content);
                return reserved.name;
            },
            reservePassage(hint) {
                const base = sanitisePassageName(hint) || "more";
                let name = base;
                for (let n = 2; extraPassages.some(p => p.startsWith(`[${name}]:\n`)) || name == section; n++) name = `${base} ${n}`;
                const index = extraPassages.length;
                extraPassages.push(`[${name}]:\n`);
                return {
                    name,
                    fill: content => {
                        // Left out, rather than empty, if it can't be converted
                        extraPassages[index] = "";
                        extraPassages[index] = `[${name}]:\n${generated(content)}`;
                    },
                };
            },
            addSection(hint, content) {
                const name = story.uniqueSectionName(hint);
                story.extraSections.push(`[[${name}]]:\n${generated(content)}`);
                return name;
            },
            newLabel: hint => story.newLabel(hint),
    });
    const convert = (passage: TwinePassage, section: string, extraPassages: string[]): ConvertedPassage => {
        const ctx = context(passage, section, extraPassages);
        try {
            return harlowe ? convertHarlowePassage(passage.text, ctx) : convertSugarCubePassage(passage.text, ctx);
        }
        catch (e) {
            if (!(e instanceof Unconvertible)) throw e;
            return { directives: [], body: ctx.unconvertible(passage.text, `This passage couldn't be converted: ${e.message}.`) };
        }
    };

    const startPassage = twine.start && story.sectionFor(twine.start) ? twine.start : storyPassages[0]?.name;
    const startSection = startPassage === undefined ? undefined : story.sectionFor(startPassage);

    // The master section: one screen per passage, as in Twine, and the header passages
    const masterPassages: string[] = [];
    const master: ConvertedPassage = { directives: ["@clear"], body: "" };
    for (const p of headers) {
        const converted = convert(p, "", masterPassages);
        master.directives.push(...converted.directives);
        if (converted.body.trim()) master.body += converted.body.trim() + "\n";
    }

    // SugarCube's sidebar passages, as panels beside the story, rendered again after each passage
    sortPanelPassages(panelPassages);
    const panels: Panel[] = [];
    for (const p of panelPassages) {
        const converted = convert(p, "", masterPassages);
        let passageName = p.name;
        for (let n = 2; masterPassages.some(text => text.startsWith(`[${passageName}]:\n`)); n++) passageName = `${p.name} ${n}`;
        const body = converted.body.trim();
        if (converted.directives.length) {
            story.addProblem({ passage: p.name, text: converted.directives.join(" "), reason: "A panel only shows its text, so this doesn't run." });
        }
        if (/\[\[|\]\(|\{\{(section|passage)\b/.test(body)) {
            story.addProblem({ passage: p.name, text: p.name, reason: "This is a panel beside the story, where links don't work." });
        }
        masterPassages.push(`[${passageName}]:\n${finishText(body)}`.trimEnd());
        panels.push({ passage: passageName, label: sugarCubePanels[p.name], position: "side" });
    }

    // Passages that run once at the start
    const init: ConvertedPassage = { directives: [], body: "" };
    for (const p of startup) {
        const converted = convert(p, startSection ?? "", []);
        init.directives.push(...converted.directives);
        if (converted.body.trim()) init.body += converted.body.trim() + "\n";
    }

    const footerEmbeds = footers.map(p => `{{embed ${quote(story.sectionFor(p.name)!)}}}`);
    const sections: string[] = [];
    for (const p of sectionPassages) {
        const section = story.sectionFor(p.name)!;
        const extraPassages: string[] = [];
        const converted = convert(p, section, extraPassages);
        const directives = [...converted.directives];
        // Its tags (#449), which Twine puts on the page for the stylesheet
        const classes = footers.includes(p) ? [] : tagClasses(p.tags);
        if (classes.length) directives.push(`@class ${classes.join(" ")}`);
        let body = converted.body.trim();
        if (p.name == startPassage && (init.directives.length || init.body)) {
            directives.unshift(...init.directives);
            body = (init.body + body).trim();
        }
        if (!footers.includes(p) && footerEmbeds.length) {
            body = (body + "\n" + footerEmbeds.join("\n")).trim();
        }
        sections.push([`[[${section}]]:\n${block({ directives, body })}`.trimEnd(), ...extraPassages.filter(p => p)].join("\n\n"));
    }

    for (const p of widgets) {
        const extraPassages: string[] = [];
        let converted: { section: string, converted: ConvertedPassage }[];
        try {
            converted = convertSugarCubeWidgets(p.text, context(p, "", extraPassages));
        }
        catch (e) {
            if (!(e instanceof Unconvertible)) throw e;
            problems.push({ passage: p.name, text: p.name, reason: `This widget passage couldn't be converted: ${e.message}.` });
            continue;
        }
        for (const w of converted) {
            sections.push([`[[${w.section}]]:\n${block(w.converted)}`, ...extraPassages.filter(p => p)].join("\n\n"));
            extraPassages.length = 0;
        }
    }

    const files: Record<string, string> = {};
    const header: string[] = [];
    if (twine.title) header.push(`@title ${twine.title.replace(/\s+/g, " ").trim()}`);
    if (startSection !== undefined) header.push(`@start ${startSection}`);
    if (twine.stylesheet) {
        // squiffy.json makes it part of the story
        const stylesheet = convertTagSelectors(twine.stylesheet);
        files[`${name}.css`] = stylesheet + "\n";
        const tagRules = stylesheet != twine.stylesheet
            ? " Its rules for passage tags now use the classes that @class puts on the story's element."
            : "";
        problems.push({
            text: `${name}.css`,
            reason: `The story's stylesheet is in ${name}.css. Its rules for ${harlowe ? "Harlowe's elements (tw-story, tw-passage, tw-link and so on)" : "SugarCube's elements (#story, .passage, #ui-bar and so on)"} won't apply to Squiffy's, so check how it looks.${tagRules}`,
        });
    }
    // The story's JavaScript is left out of it, as it was written for another story format
    const exclude: string[] = [];
    if (twine.script) {
        files[`${name}.js`] = twine.script + "\n";
        exclude.push(`${name}.js`);
        problems.push({
            text: `${name}.js`,
            reason: `The story's JavaScript is in ${name}.js, but it isn't part of the story yet, since it was written for ${twine.formatName || "Twine"}. To use it, change it to work with Squiffy, then remove "${name}.js" from "exclude" in squiffy.json (in the editor, choose Include in story from its menu in the files list).`,
        });
    }

    const masterPassageText = masterPassages.length ? "\n\n" + masterPassages.join("\n\n") : "";
    const script = [
        header.join("\n"),
        `[[]]:\n${block(master)}${masterPassageText}`,
        ...sections,
        ...story.extraSections,
    ].filter(s => s.length).join("\n\n") + "\n";

    files[`${name}.squiffy`] = script;
    const map = mapPositions(sectionPassages, story);
    files["squiffy.json"] = formatProjectFile({ main: `${name}.squiffy`, exclude, panels, ...(map ? { map } : {}) });

    return {
        title: twine.title,
        format: `${twine.formatName} ${twine.formatVersion}`.trim(),
        files,
        main: `${name}.squiffy`,
        passages: sectionPassages.length,
        problems: [...problems, ...story.noteProblems(), ...story.problems],
    };
}

// SugarCube's sidebar passages in the order SugarCube shows them
function sortPanelPassages(passages: TwinePassage[]) {
    const order = Object.keys(sugarCubePanels);
    passages.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

// Where the sections go on the editor's story map, so it looks like the story's map in Twine.
// Twine's boxes are 100 by 100, on a grid of 25, and usually 125 apart; the map's are short and
// wide, up to 190 across, so the map is stretched sideways to keep them from overlapping (which
// leaves only a handful overlapping in real games). Undefined if the story's passages have no
// places on the map, or have never been arranged.
const MAP_STRETCH = 1.6;

function mapPositions(passages: TwinePassage[], story: StoryContext): MapPositions | undefined {
    const placed = passages.filter(p => p.position);
    if (!placed.length || unarranged(story.twine.passages)) return undefined;
    const centres = placed.map(p => {
        const [w, h] = p.size ?? [100, 100];
        return { name: story.sectionFor(p.name)!, x: p.position![0] + w / 2, y: p.position![1] + h / 2 };
    });
    const left = Math.min(...centres.map(c => c.x));
    const top = Math.min(...centres.map(c => c.y));
    const sections: MapPositions["sections"] = {};
    for (const c of centres) sections[c.name] = [Math.round((c.x - left) * MAP_STRETCH), Math.round(c.y - top)];
    return { sections, passages: {} };
}

// Whether the passages are where Twine or Tweego put them when the story was made from Twee
// without positions: in rows of ten, 125 apart. A map like that says nothing about the story, and
// the editor's own layout is better. It still counts if the author's moved one or two.
function unarranged(passages: TwinePassage[]): boolean {
    const positions = passages.flatMap(p => p.position ? [p.position] : []);
    if (positions.length < 10) return false;
    const left = Math.min(...positions.map(p => p[0]));
    const top = Math.min(...positions.map(p => p[1]));
    const onGrid = positions.filter(([x, y]) => (x - left) % 125 == 0 && (y - top) % 125 == 0 && x - left < 1250);
    const columns = new Set(onGrid.map(([x]) => x));
    return columns.size == 10 && onGrid.length >= positions.length * 0.9;
}

// Tags that mean something to Harlowe, SugarCube or Twine itself, rather than ones the story
// gave its passages
const SPECIAL_TAGS = new Set(["header", "footer", "startup", "widget", "nobr", "init", "stylesheet", "script"]);

// A passage's tags, which become @class (#449): Harlowe and SugarCube put them on the page
export function tagClasses(tags: string[]): string[] {
    return [...new Set(tags.filter(t => !SPECIAL_TAGS.has(t) && !t.startsWith("debug-") && !t.startsWith("Twine.")))];
}

// A class name in a CSS selector, escaped if it needs to be
function cssClass(name: string): string {
    if (/^-?[A-Za-z_][\w-]*$/.test(name)) return "." + name;
    return "." + [...name].map((c, i) => {
        if (/[\w-]/.test(c) && !(i == 0 && /\d/.test(c))) return c;
        if (/\d/.test(c)) return `\\${c.charCodeAt(0).toString(16)} `;
        return "\\" + c;
    }).join("");
}

// Rules for passage tags (#449), e.g. tw-story[tags~="dark"] in Harlowe or
// body[data-tags~="dark"] in SugarCube, become rules for the classes @class puts on the story's
// element, as do SugarCube's classes on the body (from tags, or <<addclass "body">>). In Twine,
// tw-story, html and body are the whole page, so they become body:has(.dark), and the passage
// becomes the story's element.
export function convertTagSelectors(css: string): string {
    return css
        .replace(/(\b(?:tw-story|html|body)|tw-passage|\.passage|#passages|#story)?((?:\[\s*(?:data-)?tags\s*~=\s*(["']?)[^"'\]\s]+\3\s*\])+)/g,
            (_, element: string | undefined, attributes: string) => {
                const classes = [...attributes.matchAll(/~=\s*(["']?)([^"'\]\s]+)\1/g)].map(m => cssClass(m[2])).join("");
                return element && /^(?:tw-story|html|body)$/.test(element) ? `body:has(${classes})` : classes;
            })
        .replace(/(^|[\s,>+~(}])body((?:\.[\w-]+)+)/g, "$1body:has($2)");
}

// The text of a section or passage: its directives, then its text
function block(content: ConvertedPassage | string): string {
    const c = typeof content == "string" ? { directives: [], body: content } : content;
    return [...c.directives, finishText(c.body)].filter(l => l.length).join("\n");
}

// A passage or section made for a link. It's shown on its own, after the link's loop has finished,
// so it can't use the loop's item or position: StoryContext.linkBody makes them attributes instead.
function generated(content: ConvertedPassage | string): string {
    const c = typeof content == "string" ? { directives: [], body: content } : content;
    // Directives are expressions, rather than text with {{...}} in it
    if (c.directives.some(d => usesOuterLoop(`{{${d}}}`)) || usesOuterLoop(c.body)) {
        throw new Unconvertible("a link in a loop that does more than set variables to the loop's item");
    }
    return block(c);
}

// Whether Squiffy text uses the item or position of a loop it isn't in
export function usesOuterLoop(text: string): boolean {
    let depth = 0;
    // Comments keep the Twine code, which can have "this" in it
    for (const tag of text.replace(/\{\{!--[\s\S]*?--\}\}/g, "").matchAll(/\{\{([\s\S]*?)\}\}/g)) {
        // Text in quotes isn't a reference
        const inner = tag[1].replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "\"\"");
        if (inner.startsWith("/each")) {
            depth--;
            continue;
        }
        for (const ref of inner.matchAll(/(?<![\w$@.])((?:\.\.\/)*)this\b|@((?:\.\.\/)*)index\b/g)) {
            const up = (ref[1] ?? ref[2] ?? "").length / 3;
            if (up >= depth) return true;
        }
        if (inner.startsWith("#each")) depth++;
    }
    return false;
}

// A name for a generated passage, from a link's text, which can have markup in it
function sanitisePassageName(name: string): string {
    const plain = name
        .replace(/\{\{[\s\S]*?\}\}/g, "")
        .replace(/\([\w-]+:[^()]*(\([^()]*\)[^()]*)*\)/g, "")
        .replace(/<[^>]*>|&#?\w+;|''|\/\/|[*_~^]/g, "")
        .replace(/[$_]\w+/g, "")
        .replace(/[[\]]/g, " ");
    let result = sanitiseName(plain).replace(/:/g, "").trim();
    if (result.length > 40) result = result.substring(0, 40).replace(/\s+\S*$/, "");
    return result.trim();
}

function oneLine(text: string): string {
    const line = text.replace(/\s+/g, " ").trim();
    return line.length > 120 ? line.substring(0, 117) + "..." : line;
}

// Directives the compiler would read at the start of a line
const directiveLine = /^@(title|import|start|set|unset|inc|dec|ui|clear|end|class)\b/;
// Lines that only hold helpers that write nothing
const silentHelper = /\{\{(?:!--[\s\S]*?--|![^}]*|~?\s*(?:#if|#unless|else|\/if|\/unless|set|unset|inc|dec|goto|music|stopmusic|sound|stopsounds|addclass|removeclass|toggleclass|append|prepend|remove|#label|\/label|#replace|\/replace|#animate|\/animate)\b(?:[^{}]|\{\{[^{}]*\}\})*)\}\}/g;

function isSilent(line: string): boolean {
    return line.replace(silentHelper, "").trim() == "";
}

// Markdown that starts a block, which can't be joined to the line before with <br>
function isBlockLine(line: string): boolean {
    return /^(#{1,6}\s|[*+-]\s|\d+\.\s|<hr>|<\/?(div|p|ul|ol|li|table|tr|td|th|h\d|blockquote|pre|center|section|article|br)\b)/i.test(line)
        || /<\/(div|p|ul|ol|table|h\d|blockquote|pre|center|section|article)>\s*$/i.test(line);
}

// Tidies converted passage text into lines the compiler reads as text. In Twine, each line
// break in a passage is a line break in the story, but in Markdown a single line break is just a
// space, so lines that follow each other get a <br>.
export function finishText(text: string): string {
    const lines = text.replace(/\r/g, "").split("\n").map(line => {
        let l = line.trim();
        if (/^-{3,}$/.test(l)) return "<hr>";
        if (directiveLine.test(l)) l = "&#64;" + l.substring(1);
        if (l.startsWith("+++")) l = "&#43;" + l.substring(1);
        if (l.startsWith(">")) l = "&gt;" + l.substring(1);
        // A link on its own followed by a colon would be read as a section or passage header
        if (/^\[.*\]:$/.test(l)) l = l.substring(0, l.length - 1) + "&#58;";
        return l;
    });

    // Collapse runs of blank lines
    const collapsed: string[] = [];
    for (const line of lines) {
        if (line == "" && (collapsed.length == 0 || collapsed[collapsed.length - 1] == "")) continue;
        collapsed.push(line);
    }
    while (collapsed.length && collapsed[collapsed.length - 1] == "") collapsed.pop();

    for (let i = 0; i < collapsed.length - 1; i++) {
        const line = collapsed[i];
        if (line == "" || isSilent(line) || isBlockLine(line) || line.endsWith("<br>")) continue;
        // The next line that writes something, if it's straight after this one
        let j = i + 1;
        while (j < collapsed.length && collapsed[j] != "" && isSilent(collapsed[j])) j++;
        if (j >= collapsed.length || collapsed[j] == "" || isBlockLine(collapsed[j])) continue;
        collapsed[i] = line + "<br>";
    }
    // A backslash before {{ would stop Handlebars reading it as a helper
    return tidyMarkup(collapsed.join("\n")).replace(/\\(?=\{\{)/g, "&#92;");
}

// Turns simple HTML emphasis into Markdown, which is easier to read and edit
function tidyMarkup(text: string): string {
    return text
        .replace(/<b>([^<>*\n\s](?:[^<>*\n]*[^<>*\n\s])?)<\/b>/g, "**$1**")
        .replace(/<strong>([^<>*\n\s](?:[^<>*\n]*[^<>*\n\s])?)<\/strong>/g, "**$1**")
        .replace(/<i>([^<>*_\n\s](?:[^<>*_\n]*[^<>*_\n\s])?)<\/i>/g, "_$1_")
        .replace(/<em>([^<>*_\n\s](?:[^<>*_\n]*[^<>*_\n\s])?)<\/em>/g, "_$1_");
}

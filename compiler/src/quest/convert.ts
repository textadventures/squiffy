// Converts a Quest gamebook, from Quest 5 or Quest Viva, into a Squiffy story: each page becomes a section, and its options
// become links. Like the Twine converter, this is a pure function with no I/O: the CLI and the
// editor read the game (from a .aslx file, or the game.aslx in a .quest file) and write the files
// it returns. Anything that can't be converted is kept as a comment in the story and listed as a
// problem, so the author can deal with it by hand.

import { formatProjectFile } from "../project.js";
import { finishText, reservedAttributes, sanitiseName, sectionLink, urlLink } from "../twine/convert.js";
import { attributeRef, print, quote } from "../twine/expression.js";
import type { Expr } from "../twine/expression.js";
import { parseQuestGame, QuestParseError } from "./aslx.js";
import type { QuestGame, QuestObject, QuestValue } from "./aslx.js";
import { ScriptParser } from "./script.js";
import type { QStmt } from "./script.js";
import { convertScript, linkChanges } from "./scripts.js";
import type { ScriptContext } from "./scripts.js";
import { convertQuestText, escapeLineStarts } from "./text.js";
import type { TextContext } from "./text.js";

export interface QuestConversionProblem {
    // The Quest page the problem is in, if it's in one
    page?: string;
    // The Quest code or text that couldn't be converted
    text: string;
    reason: string;
}

export interface QuestConversionResult {
    title: string;
    // e.g. "Quest 5.5 gamebook"
    format: string;
    // The story's files, by name: the .squiffy file, squiffy.json, and a stylesheet if the game
    // has its own colours or fonts
    files: Record<string, string>;
    // The name of the main .squiffy file in files
    main: string;
    // The number of pages converted
    pages: number;
    // The files the story uses, such as images and sounds, which should be copied next to it
    assets: string[];
    problems: QuestConversionProblem[];
}

export interface QuestConversionOptions {
    // The base name for the files, without an extension. Defaults to "story".
    name?: string;
    // The other files that came with the game (in its .quest file, or its folder), if known: the
    // story is checked for images and sounds that aren't there, and their JavaScript and CSS is
    // kept out of the story
    files?: string[];
}

export function convertQuestGamebook(source: string, options: QuestConversionOptions = {}): QuestConversionResult {
    const game = parseQuestGame(source);
    if (!game.gamebook) {
        throw new QuestParseError("This is a Quest text adventure, not a gamebook. Only gamebooks can be converted to Squiffy.");
    }
    return convertGame(game, options);
}

// A Quest object's attribute, as text, or "" if it isn't text
function stringAttribute(o: QuestObject, name: string): string {
    const value = o.attributes.get(name);
    return value?.type == "string" ? value.value : "";
}

// Whether converted script plays a sound once, which Quest would stop at the next page
function playsSound(line: string): boolean {
    return line.includes("{{sound ");
}

function booleanValue(value: QuestValue | undefined): boolean | undefined {
    return value?.type == "boolean" ? value.value : undefined;
}

// A comment in the story, for Quest code that couldn't be converted. Handlebars comments can't
// contain --}}, and line breaks would let the compiler read a line of it as something else.
function comment(text: string): string {
    const clean = text.replace(/--\}\}/g, "-- }}").replace(/\s*\n\s*/g, " ").trim();
    return `{{!-- Quest: ${clean} --}}`;
}

function oneLine(text: string): string {
    const line = text.replace(/\s+/g, " ").trim();
    return line.length > 120 ? line.substring(0, 117) + "..." : line;
}

function convertGame(game: QuestGame, options: QuestConversionOptions): QuestConversionResult {
    const name = options.name ?? "story";
    const problems: QuestConversionProblem[] = [];
    const problemKeys = new Set<string>();
    const addProblem = (problem: QuestConversionProblem) => {
        const key = `${problem.page}\u0000${problem.text}\u0000${problem.reason}`;
        if (problemKeys.has(key)) return;
        problemKeys.add(key);
        problems.push(problem);
    };
    const assets = new Set<string>();
    const gameSetting = (setting: string) => game.game.attributes.get(setting) ?? game.gameDefaults.get(setting);

    // Link pages go to a web page, rather than being pages of the story
    const isLinkPage = (p: QuestObject) => p.inherits.includes("link");
    const pagesByName = new Map(game.pages.map(p => [p.name, p]));
    const storyPages = game.pages.filter(p => !isLinkPage(p));

    // Pages keep their names where they can: a name that's the same as another once it's been
    // tidied up gets a number
    const sectionNames = new Map<string, string>();
    const usedNames = new Set<string>();
    const wanted = storyPages.map(p => sanitiseName(p.name) || "Untitled");
    storyPages.forEach((p, n) => {
        if (!usedNames.has(wanted[n].toLowerCase())) {
            sectionNames.set(p.name, wanted[n]);
            usedNames.add(wanted[n].toLowerCase());
        }
    });
    storyPages.forEach((p, n) => {
        if (sectionNames.has(p.name)) return;
        let candidate = wanted[n];
        for (let i = 2; usedNames.has(candidate.toLowerCase()); i++) candidate = `${wanted[n]} ${i}`;
        sectionNames.set(p.name, candidate);
        usedNames.add(candidate.toLowerCase());
    });

    const target = (page: string): { section: string } | { url: string } | undefined => {
        const p = pagesByName.get(page);
        if (!p) return undefined;
        if (isLinkPage(p)) return { url: stringAttribute(p, "address") };
        return { section: sectionNames.get(p.name)! };
    };

    // Quest keeps flags and counters as attributes of the game. Most can keep their names.
    const attribute = (questName: string): string => {
        const trimmed = questName.trim();
        return reservedAttributes.has(trimmed) ? trimmed + "_" : trimmed;
    };

    const startPage = (game.start && sectionNames.has(game.start) ? game.start : undefined) ?? storyPages[0]?.name;
    const title = game.game.name.replace(/\s+/g, " ").trim();
    const showTitle = booleanValue(gameSetting("showtitle")) ?? true;
    const clearLastPage = booleanValue(gameSetting("clearlastpage")) ?? false;

    // The game's scripts are read first, as they can add links to other pages, which those pages
    // need to show
    const objectNames = new Set([...game.pages.map(p => p.name), "game", "player"]);
    const isPage = (name: string) => pagesByName.has(name);
    const pageScripts = new Map<string, QStmt[]>();
    const scriptOnlyPages = new Set<string>();
    for (const page of storyPages) {
        const runScript = booleanValue(page.attributes.get("runscript")) || page.inherits.includes("scripttext");
        const scriptOnly = booleanValue(page.attributes.get("runscriptonly")) || page.inherits.includes("script");
        if (scriptOnly) scriptOnlyPages.add(page.name);
        const script = page.attributes.get("script");
        if ((runScript || scriptOnly) && script?.type == "script" && script.value.trim()) {
            pageScripts.set(page.name, ScriptParser.parse(script.value, objectNames));
        }
    }
    const roomEnterValue = game.game.attributes.get("roomenter");
    const roomEnter = roomEnterValue?.type == "script" && roomEnterValue.value.trim() ? ScriptParser.parse(roomEnterValue.value, objectNames) : undefined;

    // The links that scripts add or remove (AddPageLink and RemovePageLink). Each has an
    // attribute, which is true while it's shown, or the text it's shown with if it can have more
    // than one, which one. Links on a page to begin with are set when the story starts.
    interface DynamicLink { attribute: string, texts: string[], initial?: string }
    const dynamicLinks = new Map<string, DynamicLink>();
    const addedLinks = new Map<string, string[]>();
    const usedLinkAttributes = new Set<string>();
    const initialOptions = (p: QuestObject | undefined): [string, string][] => {
        const value = p?.attributes.get("options");
        return value?.type == "stringdictionary" ? value.value : [];
    };
    const dynamicLink = (source: string, destination: string): DynamicLink => {
        const key = `${source}\u0000${destination}`;
        let link = dynamicLinks.get(key);
        if (!link) {
            const base = `link_${sectionNames.get(source) ?? source}_${sectionNames.get(destination) ?? destination}`.replace(/[^\p{L}\p{N}_]+/gu, "_");
            let name = base;
            for (let n = 2; usedLinkAttributes.has(name.toLowerCase()); n++) name = `${base}_${n}`;
            usedLinkAttributes.add(name.toLowerCase());
            const initial = initialOptions(pagesByName.get(source)).find(([d]) => d == destination)?.[1];
            link = { attribute: name, texts: initial === undefined ? [] : [initial], initial };
            dynamicLinks.set(key, link);
            if (initial === undefined) addedLinks.set(source, [...addedLinks.get(source) ?? [], destination]);
        }
        return link;
    };
    for (const [page, statements] of [...pageScripts, ["", roomEnter ?? []] as const]) {
        for (const change of linkChanges(statements, page || undefined, isPage)) {
            const link = dynamicLink(change.source, change.destination);
            if (change.text !== undefined && !link.texts.includes(change.text)) link.texts.push(change.text);
        }
    }
    // With more than one text, the attribute is which one, counting from 1
    const linkValue = (link: DynamicLink, text: string): Expr => link.texts.length > 1 ? { k: "num", v: link.texts.indexOf(text) + 1 } : { k: "bool", v: true };

    let firstTimes = 0;
    let styled = false;
    const scriptContext = (ctx: TextContext, page?: string): ScriptContext => ({
        ...ctx,
        page,
        isPage,
        linkAttribute: (source, destination) => dynamicLink(source, destination).attribute,
        linkValue: (source, destination, text) => linkValue(dynamicLink(source, destination), text),
        newFirstTime: () => `firsttime_${++firstTimes}`,
        noteStyle: () => { styled = true; },
    });

    let soundStops = false;
    const sections: string[] = [];
    for (const page of storyPages) {
        const section = sectionNames.get(page.name)!;
        const passages: string[] = [];
        const ctx: TextContext = {
            section,
            target,
            attribute,
            unconvertible(text, reason) {
                addProblem({ page: page.name, text: oneLine(text), reason });
                return comment(text);
            },
            approximate(text, reason) {
                addProblem({ page: page.name, text: oneLine(text), reason });
            },
            addPassage(hint, content) {
                const base = sanitiseName(hint.replace(/<[^>]*>|\{[^{}]*\}/g, "")).replace(/:/g, "").substring(0, 40).trim() || "more";
                let passage = base;
                for (let n = 2; passages.some(p => p.startsWith(`[${passage}]:\n`)) || passage == section; n++) passage = `${base} ${n}`;
                passages.push(`[${passage}]:\n${finishText(escapeLineStarts(content))}`);
                return passage;
            },
            asset(file) {
                if (file && !/^(https?:)?\/\//i.test(file)) assets.add(file);
            },
        };

        const lines: string[] = [];
        const directives: string[] = [];
        if (page.name == startPage) {
            const initial = [...dynamicLinks.values()].filter(l => l.initial !== undefined);
            const parts: string[] = [];
            if (showTitle && title) {
                const subtitle = stringAttribute(game.game, "subtitle").trim();
                const author = stringAttribute(game.game, "author").trim();
                const heading = [`<h1>${convertQuestText(title, ctx, "inline")}</h1>`];
                if (subtitle) heading.push(`<p>${convertQuestText(subtitle, ctx, "inline")}</p>`);
                if (author) heading.push(`<p>${convertQuestText(author, ctx, "inline")}</p>`);
                parts.push(`<div class="quest-title" style="text-align: center">${heading.join("")}</div>`);
            }
            // Quest shows the title once, when the game starts, and many gamebooks go back to
            // their first page to play again
            if (initial.length || parts.length) {
                lines.push(
                    `{{#if (visits ${quote(section)}) = 1}}`,
                    ...initial.map(l => `{{set ${quote(l.attribute)} ${print(linkValue(l, l.initial!))}}}`),
                    ...parts,
                    "{{/if}}",
                );
            }
        }

        const scriptOnly = scriptOnlyPages.has(page.name);
        const option = (destination: string, text: string): string => {
            const linkText = convertQuestText(text || destination, ctx, "inline");
            const to = target(destination);
            if (!to) {
                addProblem({ page: page.name, text: oneLine(text || destination), reason: `This option goes to a page called "${destination}", which isn't in the game. Quest shows it as a broken link, so it isn't a link here.` });
                return `${linkText} (broken link)`;
            }
            return "url" in to ? urlLink(linkText, to.url) : sectionLink(linkText, to.section);
        };
        const dynamic = (destination: string, link: DynamicLink): string[] => link.texts.flatMap((text, i) => [
            `{{#if ${link.texts.length > 1 ? `${attributeRef(link.attribute)} = ${i + 1}` : attributeRef(link.attribute)}}}`,
            option(destination, text),
            "{{/if}}",
        ]);
        // The page's links, made when they're first needed, so problems are listed in the order of
        // the page. A page that only runs its script shows no links.
        let optionLines: string[] | undefined;
        const pageLinks = (): string[] => {
            if (optionLines) return optionLines;
            optionLines = [];
            if (scriptOnly) return optionLines;
            for (const [destination, text] of initialOptions(page)) {
                const link = dynamicLinks.get(`${page.name}\u0000${destination}`);
                optionLines.push(...(link ? dynamic(destination, link) : [option(destination, text)]));
            }
            for (const destination of addedLinks.get(page.name) ?? []) {
                optionLines.push(...dynamic(destination, dynamicLinks.get(`${page.name}\u0000${destination}`)!));
            }
            return optionLines;
        };

        const statements = pageScripts.get(page.name);
        let moves = false;
        // Sections for what happens after the player types something (GetInput), which go after
        // this one
        const continued: string[] = [];
        const continueSection = (content: string): string => {
            let name = `${section} continued`;
            for (let n = 2; usedNames.has(name.toLowerCase()); n++) name = `${section} continued ${n}`;
            usedNames.add(name.toLowerCase());
            const links = pageLinks();
            const text = [content, ...(links.length ? ["", ...links] : [])].join("\n");
            const leavesHere = /\[\[|<a href|\{\{goto/.test(text);
            continued.push(`[[${name}]]:\n${[...(leavesHere ? [] : ["@end"]), finishText(escapeLineStarts(text))].filter(l => l).join("\n")}`);
            return name;
        };
        if (statements) {
            const script = convertScript(statements, { ...scriptContext(ctx, page.name), continueSection });
            if (script.lines.some(playsSound)) soundStops = true;
            directives.push(...script.directives);
            lines.push(...script.lines);
            moves = script.lines.some(l => l.includes("{{goto"));
        }

        if (!scriptOnly) {
            const picture = stringAttribute(page, "picture").trim();
            if (picture) {
                ctx.asset(picture);
                lines.push(`<img class="quest-picture" src="${escapeAttribute(picture)}" alt="">`, "");
            }
            const youtube = youTubeId(stringAttribute(page, "youtube"));
            if (youtube) {
                lines.push(`<iframe class="quest-youtube" width="560" height="315" src="https://www.youtube.com/embed/${encodeURIComponent(youtube)}" allowfullscreen></iframe>`, "");
            }
            const sound = stringAttribute(page, "sound").trim();
            if (sound) {
                ctx.asset(sound);
                // Quest stops a page's sound when the player goes to another page, unless the
                // page is set to continue playing it, but Squiffy can't stop a sound
                if (!booleanValue(page.attributes.get("continuesound"))) soundStops = true;
                directives.push(`@sound ${sound}`);
            }

            lines.push(convertQuestText(stringAttribute(page, "description"), ctx, "block"));

            const links = pageLinks();
            if (links.length) lines.push("", ...links);

            if (moves) {
                addProblem({
                    page: page.name, text: page.name,
                    reason: "This page's script can go to another page. In Quest, the rest of the page wasn't shown then, but here its text and links are shown first.",
                });
            }
        }
        // A page with no links, and no script that goes somewhere, is one of the endings
        const leaves = (l: string) => l.includes("[[") || l.includes("<a href") || l.includes("{{goto");
        if (!lines.some(leaves) && !passages.some(leaves)) directives.push("@end");

        const body = finishText(escapeLineStarts(lines.join("\n")));
        sections.push([`[[${section}]]:\n${[...directives, body].filter(l => l).join("\n")}`.trimEnd(), ...passages, ...continued].join("\n\n"));
    }

    for (const p of game.pages.filter(isLinkPage)) {
        if (!stringAttribute(p, "address").trim()) {
            addProblem({ page: p.name, text: p.name, reason: "This link page has no web address." });
        }
    }

    // The master section runs with every section, as the game's roomenter script runs on every page
    const master: string[] = [];
    if (clearLastPage) master.push("@clear");
    if (roomEnter) {
        const ctx: TextContext = {
            section: "",
            target,
            attribute,
            unconvertible(text, reason) {
                addProblem({ text: oneLine(text), reason: `${reason} It's in the script that runs on every page, in the master section, [[]].` });
                return comment(text);
            },
            approximate(text, reason) {
                addProblem({ text: oneLine(text), reason });
            },
            asset(file) {
                if (file && !/^(https?:)?\/\//i.test(file)) assets.add(file);
            },
        };
        const script = convertScript(roomEnter, scriptContext(ctx));
        if (script.lines.some(playsSound)) soundStops = true;
        master.push(...script.directives);
        const body = finishText(escapeLineStarts(script.lines.join("\n")));
        if (body) master.push(body);
    }
    if (styled && clearLastPage) {
        addProblem({ text: "SetBackgroundColour", reason: "The game clears the screen before each page, so a script's changes to how it looks, such as its colours or font, only last until the next page. To keep one, set it in story.css." });
    }
    for (const [setting, value] of game.game.attributes) {
        if (value.type == "script" && setting != "roomenter" && value.value.trim()) {
            addProblem({ text: setting, reason: `The game's "${setting}" script can't be converted yet: ${oneLine(value.value)}` });
        }
    }
    if (soundStops) {
        addProblem({ text: "sound", reason: "Sounds play to the end. In Quest, a sound stopped when the player went to another page, unless the page with the sound was set to continue playing it." });
    }
    for (const file of game.javascript) {
        addProblem({ text: file, reason: "The game's JavaScript was written for Quest, so it isn't part of the story." });
    }

    const files: Record<string, string> = {};
    const exclude: string[] = [];
    if (options.files) {
        const available = new Set(options.files.map(f => f.toLowerCase()));
        for (const asset of assets) {
            if (!available.has(asset.toLowerCase())) {
                addProblem({ text: asset, reason: "The game uses this file, but it wasn't found with the game." });
            }
        }
        // Quest's own scripts and styles would break Squiffy's page
        exclude.push(...options.files.filter(f => /\.(js|css)$/i.test(f)));
    }

    const css = stylesheet(game, gameSetting);
    if (css) files[`${name}.css`] = css;

    const header: string[] = [];
    if (title) header.push(`@title ${title}`);
    const startSection = startPage === undefined ? undefined : sectionNames.get(startPage);
    if (startSection !== undefined) header.push(`@start ${startSection}`);
    const script = [
        header.join("\n"),
        master.length ? `[[]]:\n${master.join("\n")}` : "",
        ...sections,
    ].filter(s => s.length).join("\n\n") + "\n";
    files[`${name}.squiffy`] = script;
    files["squiffy.json"] = formatProjectFile({ main: `${name}.squiffy`, exclude });

    return {
        title,
        format: `${productName(game.aslVersion)} gamebook`,
        files,
        main: `${name}.squiffy`,
        pages: storyPages.length,
        assets: [...assets],
        problems,
    };
}

// The version of Quest a game was saved by, from its ASL version: Quest 5 (e.g. "550" is 5.5), or
// from version 6, Quest Viva
function productName(aslVersion: string): string {
    const version = /^(\d)(\d)\d$/.exec(aslVersion);
    if (!version) return "Quest";
    return `${Number(version[1]) >= 6 ? "Quest Viva" : "Quest"} ${version[1]}.${version[2]}`;
}

function escapeAttribute(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/\[/g, "&#91;").replace(/\]/g, "&#93;");
}

// A YouTube video's id, from what the author typed: the id, or the video's address
function youTubeId(text: string): string {
    const t = text.trim();
    const match = /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{6,})/.exec(t);
    return match ? match[1] : t;
}

// The game's colours, fonts and page width, as a stylesheet. Only the ones the author chose are
// included: the rest follow Squiffy's defaults, which have light and dark versions.
function stylesheet(game: QuestGame, setting: (name: string) => QuestValue | undefined): string | undefined {
    const own = (name: string): string => {
        const value = game.game.attributes.get(name);
        if (value?.type == "string") return value.value.trim();
        if (value?.type == "number") return String(value.value);
        return "";
    };
    const variables: string[] = [];
    const imports: string[] = [];

    const background = own("defaultbackground");
    const foreground = own("defaultforeground");
    const link = own("defaultlinkforeground");
    if (background || foreground || link) {
        // Quest shows a game with its own colours in light mode
        variables.push("color-scheme: light;");
        if (background) variables.push(`--squiffy-background: ${cssValue(background)};`);
        if (foreground) variables.push(`--squiffy-text: ${cssValue(foreground)};`);
        if (link) variables.push(`--squiffy-link: ${cssValue(link)};`, `--squiffy-link-hover: ${cssValue(link)};`);
    }

    const webFont = own("defaultwebfont");
    const font = own("defaultfont");
    if (webFont) {
        imports.push(`@import url("https://fonts.googleapis.com/css2?family=${encodeURIComponent(webFont).replace(/%20/g, "+")}&display=swap");`);
    }
    if (webFont || font) {
        const families = [webFont ? `"${webFont.replace(/["\\]/g, "")}"` : "", cssValue(font)].filter(f => f);
        variables.push(`--squiffy-font-family: ${families.join(", ")};`);
    }
    const size = own("defaultfontsize");
    if (size && Number(size) > 0) variables.push(`--squiffy-font-size: ${Number(size)}pt;`);

    const width = own("customwidth");
    const setWidth = setting("setcustomwidth");
    if (width && Number(width) > 0 && (setWidth?.type != "boolean" || setWidth.value)) {
        variables.push(`--squiffy-max-width: ${Number(width)}px;`);
    }

    if (!variables.length) return undefined;
    return [
        "/* The game's colours, fonts and page width in Quest. See https://squiffystory.com/styling/ */",
        ...imports,
        "",
        ":root {",
        ...variables.map(v => "    " + v),
        "}",
        "",
    ].join("\n");
}

// A CSS value from the game, with nothing in it that could end the rule
function cssValue(value: string): string {
    return value.replace(/[;{}<>]/g, "").trim();
}

// The problems as a text file, to keep with the converted story: the ones about the whole story,
// then each page's, in the order of the game
export function formatQuestProblems(result: QuestConversionResult, sourceName?: string): string {
    const lines = [
        `Converted ${sourceName ?? "a Quest gamebook"} (${result.format}) to Squiffy: ${result.pages} page${result.pages == 1 ? "" : "s"}.`,
        "",
    ];
    if (result.problems.length == 0) {
        lines.push("Everything was converted.");
        return lines.join("\n") + "\n";
    }
    lines.push(
        `${result.problems.length} thing${result.problems.length == 1 ? "" : "s"} couldn't be converted exactly. Where something couldn't be converted at all, the story has the`,
        "Quest code in a comment, {{!-- Quest: ... --}}, so you can search for \"Quest:\" to find them.",
        "",
    );
    const sorted = [...result.problems.filter(p => p.page === undefined), ...result.problems.filter(p => p.page !== undefined)];
    let page: string | undefined = "\u0000";
    for (const p of sorted) {
        if (p.page !== page) {
            page = p.page;
            lines.push(page === undefined ? "The whole story:" : `${page}:`);
        }
        lines.push(`  ${p.text}`, `    ${p.reason}`);
    }
    return lines.join("\n") + "\n";
}

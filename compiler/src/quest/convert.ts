// Converts a Quest gamebook into a Squiffy story: each page becomes a section, and its options
// become links. Like the Twine converter, this is a pure function with no I/O: the CLI and the
// editor read the game (from a .aslx file, or the game.aslx in a .quest file) and write the files
// it returns. Anything that can't be converted is kept as a comment in the story and listed as a
// problem, so the author can deal with it by hand.

import { formatProjectFile } from "../project.js";
import { finishText, reservedAttributes, sanitiseName, sectionLink, urlLink } from "../twine/convert.js";
import { quote } from "../twine/expression.js";
import { parseQuestGame, QuestParseError } from "./aslx.js";
import type { QuestGame, QuestObject, QuestValue } from "./aslx.js";
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

    let hasSound = false;
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
        if (page.name == startPage && showTitle && title) {
            const subtitle = stringAttribute(game.game, "subtitle").trim();
            const author = stringAttribute(game.game, "author").trim();
            const parts = [`<h1>${convertQuestText(title, ctx, "inline")}</h1>`];
            if (subtitle) parts.push(`<p>${convertQuestText(subtitle, ctx, "inline")}</p>`);
            if (author) parts.push(`<p>${convertQuestText(author, ctx, "inline")}</p>`);
            // Quest shows the title once, when the game starts, and many gamebooks go back to
            // their first page to play again
            lines.push(`{{#if (visits ${quote(section)}) = 1}}`, `<div class="quest-title" style="text-align: center">${parts.join("")}</div>`, "{{/if}}");
        }

        const runScript = booleanValue(page.attributes.get("runscript")) || page.inherits.includes("scripttext");
        const scriptOnly = booleanValue(page.attributes.get("runscriptonly")) || page.inherits.includes("script");
        const script = page.attributes.get("script");
        const hasScript = (runScript || scriptOnly) && script?.type == "script" && script.value.trim() != "";
        if (hasScript) {
            addProblem({
                page: page.name, text: oneLine(script.value),
                reason: "Scripts can't be converted yet, so this page's script is in a comment.",
            });
            lines.push(comment(script.value));
        }

        let ending = false;
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
                hasSound = true;
                lines.push(`<audio src="${escapeAttribute(sound)}" autoplay></audio>`);
            }

            lines.push(convertQuestText(stringAttribute(page, "description"), ctx, "block"));

            const optionsValue = page.attributes.get("options");
            const pageOptions = optionsValue?.type == "stringdictionary" ? optionsValue.value : [];
            if (pageOptions.length) lines.push("");
            for (const [destination, text] of pageOptions) {
                const linkText = convertQuestText(text || destination, ctx, "inline");
                const to = target(destination);
                if (!to) {
                    addProblem({ page: page.name, text: oneLine(text || destination), reason: `This option goes to a page called "${destination}", which isn't in the game. Quest shows it as a broken link, so it isn't a link here.` });
                    lines.push(`${linkText} (broken link)`);
                }
                else if ("url" in to) {
                    lines.push(urlLink(linkText, to.url));
                }
                else {
                    lines.push(sectionLink(linkText, to.section));
                }
            }
            // A page with no links, and no script that might add some, is one of the endings
            ending = !hasScript && !lines.some(l => l.includes("[[") || l.includes("<a href"));
        }
        if (ending) directives.push("@end");

        const body = finishText(escapeLineStarts(lines.join("\n")));
        sections.push([`[[${section}]]:\n${[...directives, body].filter(l => l).join("\n")}`.trimEnd(), ...passages].join("\n\n"));
    }

    for (const p of game.pages.filter(isLinkPage)) {
        if (!stringAttribute(p, "address").trim()) {
            addProblem({ page: p.name, text: p.name, reason: "This link page has no web address." });
        }
    }

    // The master section runs with every section
    const master: string[] = [];
    if (booleanValue(gameSetting("clearlastpage"))) master.push("@clear");
    const roomEnter = game.game.attributes.get("roomenter");
    if (roomEnter?.type == "script" && roomEnter.value.trim()) {
        addProblem({ text: oneLine(roomEnter.value), reason: "The game's script that runs on every page can't be converted yet, so it's in a comment in the master section, [[]]." });
        master.push(comment(roomEnter.value));
    }
    for (const [setting, value] of game.game.attributes) {
        if (value.type == "script" && setting != "roomenter" && value.value.trim()) {
            addProblem({ text: setting, reason: `The game's "${setting}" script can't be converted yet: ${oneLine(value.value)}` });
        }
    }
    if (hasSound) {
        addProblem({ text: "sound", reason: "Each page's sound plays to the end. In Quest, it stopped when the player went to another page, unless the page was set to continue playing it." });
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

    const version = /^(\d)(\d)\d$/.exec(game.aslVersion);
    return {
        title,
        format: `Quest ${version ? `${version[1]}.${version[2]}` : ""} gamebook`.replace(/\s+/g, " "),
        files,
        main: `${name}.squiffy`,
        pages: storyPages.length,
        assets: [...assets],
        problems,
    };
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

// Converts the text of a Quest gamebook page, which is HTML with Quest's text processor commands
// in it ({if ...}, {once:...}, {page:...} and so on), into Squiffy text.

import { attributeRef, display, print, quote, Unconvertible } from "../twine/expression.js";
import type { Expr } from "../twine/expression.js";
import { escapeLinkBrackets, sectionLink, urlLink } from "../twine/convert.js";

export interface TextContext {
    // The Squiffy section the text is in
    readonly section: string;
    // Where a link to a Quest page goes: a section, a web address (for a link page), or
    // undefined if there's no such page
    target(page: string): { section: string } | { url: string } | undefined;
    // The Squiffy attribute for one of the game's attributes, such as a flag or counter
    attribute(name: string): string;
    // Records a problem, and returns a comment to put in the story in place of the Quest code
    unconvertible(text: string, reason: string): string;
    // Records a problem with something that's converted, but not exactly
    approximate(text: string, reason: string): void;
    // Adds a passage to the section, returning its name, if the text can have links to passages
    addPassage?(nameHint: string, content: string): string;
    // Records a file the story uses, such as an image
    asset(file: string): void;
    // Whether the game gives the player this attribute, such as alias: on the player object, or
    // in a script
    playerHas?(attribute: string): boolean;
}

// "block" is a page's text, where line breaks become lines; "inline" is text that has to stay
// on one line, such as a link's
export type TextMode = "block" | "inline";

// Finds the next {...} the way Quest does: the first {, and the } that matches it, counting the
// ones in between. Undefined if there isn't one.
function nextCommand(text: string, from: number): { start: number, end: number } | undefined {
    const start = text.indexOf("{", from);
    if (start == -1) return undefined;
    let depth = 1;
    for (let i = start + 1; i < text.length; i++) {
        if (text[i] == "{") depth++;
        else if (text[i] == "}" && --depth == 0) return { start, end: i };
    }
    return undefined;
}

export function convertQuestText(text: string, ctx: TextContext, mode: TextMode): string {
    let result = "";
    let pos = 0;
    text = text.replace(/\r\n?/g, "\n");
    for (;;) {
        const command = nextCommand(text, pos);
        if (!command) break;
        result += literal(text.substring(pos, command.start), mode);
        const inner = text.substring(command.start + 1, command.end);
        try {
            result += convertCommand(inner, ctx, mode);
        }
        catch (e) {
            if (!(e instanceof Unconvertible)) throw e;
            result += ctx.unconvertible(`{${inner}}`, `This couldn't be converted: ${e.message}.`);
        }
        pos = command.end + 1;
    }
    return result + literal(text.substring(pos), mode);
}

// The commands Quest's gamebook text processor has, in the order it tries them
const commands = [
    "if ", "either ", "here ", "nothere ", "popup:", "i:", "b:", "s:", "u:", "colour:", "color:", "back:", "object:",
    "command:", "page:", "exit:", "once:", "notfirst:", "random:", "rndalt:", "img:", "counter:", "select:", "eval:", "=",
];

function convertCommand(section: string, ctx: TextContext, mode: TextMode): string {
    const command = commands.find(c => section.startsWith(c));
    const nested = (t: string) => convertQuestText(t, ctx, mode);
    switch (command) {
        case "if ":
            return convertIf(section, ctx, mode);
        case "i:":
        case "b:":
        case "s:":
        case "u:": {
            const tag = section[0];
            return `<${tag}>${nested(section.substring(2))}</${tag}>`;
        }
        case "colour:":
        case "color:":
        case "back:": {
            // Quest splits these at every colon, not just the first two
            const parts = section.split(":");
            const colour = parts[1] ?? "";
            const rest = parts.slice(2).join(":");
            const property = command == "back:" ? "background-color" : "color";
            return `<span style="${property}: ${escapeAttribute(colour.trim())}">${nested(rest)}</span>`;
        }
        case "command:":
        case "page:":
            return convertPageLink(section, ctx, mode);
        // Quest remembers each of these by its own text, as {{#once}} remembers each of its own
        case "once:":
            return `{{#once}}${nested(section.substring(5))}{{/once}}`;
        case "notfirst:":
            return `{{#once}}{{else}}${nested(section.substring(9))}{{/once}}`;
        case "random:":
            return convertRandom(section.substring(7), ctx);
        case "img:": {
            const file = section.substring(4).trim();
            ctx.asset(file);
            return `<img src="${escapeAttribute(file)}" alt="">`;
        }
        case "counter:":
            // Quest shows 0 for a counter that hasn't been set, as adding 0 does
            return `{{= ${attributeRef(ctx.attribute(section.substring(8)))} + 0}}`;
        case "popup:": {
            const parts = section.substring(6).split(":");
            const link = parts[0];
            const content = parts.slice(1).join(":");
            if (!ctx.addPassage || mode == "inline") {
                ctx.approximate(`{${section}}`, "Squiffy has no popups, and this one is in a link's text, so only its link text has been kept.");
                return nested(link);
            }
            // A passage link shows the popup's text when it's clicked
            const name = ctx.addPassage(link, convertQuestText(content, ctx, "block"));
            return `[${escapeLinkBrackets(nested(link))}](${name})`;
        }
        case "either ":
        case "eval:":
        case "=":
            throw new Unconvertible("Quest expressions in text can't be converted yet");
        case "here ":
        case "nothere ":
        case "object:":
        case "exit:":
            throw new Unconvertible("it's for Quest's text adventures, not gamebooks");
        case "rndalt:":
        case "select:":
            throw new Unconvertible(`Squiffy has nothing like {${command}}`);
    }
    return convertOther(section, ctx, mode);
}

// {game.score} shows an attribute. Anything else in curly brackets is shown as it is.
function convertOther(section: string, ctx: TextContext, mode: TextMode): string {
    const dot = section.indexOf(".");
    if (dot != -1) {
        const object = section.substring(0, dot);
        const attribute = section.substring(dot + 1);
        if (object == "game" && /^[\w ]+$/.test(attribute)) {
            return display({ k: "var", name: ctx.attribute(attribute) });
        }
        if (/^[\w ]+$/.test(object) && /^\w+$/.test(attribute) && (object == "player" || ctx.target(object))) {
            if (object == "player") checkPlayerAttribute(attribute, `{${section}}`, ctx);
            return display({ k: "var", name: ctx.attribute(objectAttribute(object, attribute)) });
        }
    }
    return literalBraces(convertQuestText(section, ctx, mode));
}

// Text Quest shows in curly brackets, as it doesn't know the command. They're written as
// entities, so Squiffy doesn't take them for Squiffy 5 commands.
function literalBraces(inner: string): string {
    return "&#123;" + inner + "&#125;";
}

// The Squiffy attribute for an attribute of the player or a page, such as player.strength. Flags
// and counters are attributes of the game, and keep their names.
export function objectAttribute(object: string, attribute: string): string {
    return object == "game" ? attribute : `${object}_${attribute}`;
}

// Reports an attribute of the player that nothing in the game sets, such as player.alias in a
// game that never asks for the player's name, as it shows nothing in Squiffy
function checkPlayerAttribute(attribute: string, text: string, ctx: TextContext) {
    if (ctx.playerHas?.(attribute) !== false) return;
    ctx.approximate(text, `Nothing in the game sets player.${attribute}, so this shows nothing. Set it at the start of the story, or ask the player for it with a text input.`);
}

// {if flag:text}, {if not flag:text}, {if counter>5:text}, {if game.flag:text}, {if Page3.visited:text}
function convertIf(section: string, ctx: TextContext, mode: TextMode): string {
    const command = section.substring(3);
    const colon = command.indexOf(":");
    // Quest shows an {if} with no text as it is
    if (colon == -1) return literalBraces(convertQuestText(section, ctx, mode));
    const text = convertQuestText(command.substring(colon + 1), ctx, mode);
    const condition = command.substring(0, colon);

    const operator = ["<=", ">=", "<>", "<", ">", "="].find(op => condition.includes(op));
    let expr: Expr;
    if (!operator) {
        let name = condition.trim();
        let negate = false;
        if (name.startsWith("not ")) {
            negate = true;
            name = name.substring(4).trim();
        }
        expr = reference(name, ctx);
        if (negate) expr = { k: "not", e: expr };
    }
    else {
        const index = condition.indexOf(operator);
        const lhs = reference(condition.substring(0, index).trim(), ctx);
        const rhsText = condition.substring(index + operator.length).trim();
        const rhs: Expr = /^-?\d+(\.\d+)?$/.test(rhsText) ? { k: "num", v: Number(rhsText) } : { k: "str", v: rhsText };
        expr = { k: "bin", op: operator == "<>" ? "!=" : operator as "<=" | ">=" | "<" | ">" | "=", l: lhs, r: rhs };
    }
    return `{{#if ${printCondition(expr, mode)}}}${text}{{/if}}`;
}

// A condition, as it's written in an {{#if}}. A link's text goes in a text="..." string, where
// the compiler writes a " as \", which the condition can't then read, so text in it is quoted
// with single quotes.
function printCondition(expr: Expr, mode: TextMode): string {
    if (mode == "block") return print(expr);
    const printed = print(expr, { preferSingle: true });
    if (printed.includes("\"")) throw new Unconvertible("a condition in a link's text can't compare with text that has a quote mark in it");
    return printed;
}

// A flag or counter, game.attribute, or page.visited, in an {if}
function reference(name: string, ctx: TextContext): Expr {
    const dot = name.indexOf(".");
    if (dot == -1) return { k: "var", name: ctx.attribute(name) };
    const object = name.substring(0, dot).trim();
    const attribute = name.substring(dot + 1).trim();
    if (!/^\w+$/.test(attribute)) throw new Unconvertible(`Squiffy can't read ${name}`);
    if (object == "game") return { k: "var", name: ctx.attribute(attribute) };
    const target = ctx.target(object);
    if (attribute == "visited") {
        if (target && "section" in target) return { k: "call", fn: "seen", args: [{ k: "str", v: target.section }] };
        if (!target) {
            ctx.approximate(name, `There's no page called "${object}", so this is never true, as in Quest.`);
            return { k: "bool", v: false };
        }
    }
    if (object == "player" || target) return { k: "var", name: ctx.attribute(objectAttribute(object, attribute)) };
    throw new Unconvertible(`there's nothing called "${object}" in the game`);
}

// {page:Page2}, {page:Page2:text}, and {command:Page2:text}, which does the same in a gamebook
function convertPageLink(section: string, ctx: TextContext, mode: TextMode): string {
    let page = section.substring(section.indexOf(":") + 1);
    let text = page;
    const colon = page.indexOf(":");
    if (colon != -1) {
        text = page.substring(colon + 1);
        page = page.substring(0, colon);
    }
    const linkText = convertQuestText(text, ctx, "inline");
    if (mode == "inline") {
        ctx.approximate(`{${section}}`, "This link is in a link's text, or one of a random choice, where Squiffy can't have a link, so only its text has been kept.");
        return linkText;
    }
    const target = ctx.target(page);
    if (!target) {
        ctx.approximate(`{${section}}`, `There's no page called "${page}", so this isn't a link.`);
        return linkText;
    }
    if ("url" in target) return urlLink(linkText, target.url);
    return sectionLink(linkText, target.section);
}

// Quest's Tsplit: splits at colons that aren't inside {...}
function splitItems(text: string): string[] {
    const items: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] == "{") depth++;
        else if (text[i] == "}") depth--;
        else if (text[i] == ":" && depth <= 0) {
            items.push(text.substring(start, i));
            start = i + 1;
        }
    }
    items.push(text.substring(start));
    return items;
}

function convertRandom(text: string, ctx: TextContext): string {
    const items = splitItems(text).map(item => {
        const converted = convertQuestText(item, ctx, "inline");
        if (/\{\{|\[\[/.test(converted)) throw new Unconvertible("Squiffy's {{random}} can't have links or other commands in its choices");
        return converted;
    });
    return `{{random (array${items.map(i => " " + quote(i)).join("")})}}`;
}

function escapeAttribute(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/\[/g, "&#91;").replace(/\]/g, "&#93;");
}

// Text from the page, with no commands in it, as Squiffy text. Quest's text is HTML, not
// Markdown, so anything Markdown would read is escaped, outside HTML tags. In a page's text,
// <br/> and line breaks become Squiffy lines, and two or more of them a new paragraph.
function literal(text: string, mode: TextMode): string {
    if (!text) return "";
    let result = "";
    let pos = 0;
    for (const tag of text.matchAll(/<\/?[A-Za-z][^<>]*>/g)) {
        result += prose(text.substring(pos, tag.index));
        result += tag[0].replace(/\[/g, "&#91;").replace(/\]/g, "&#93;").replace(/\{\{/g, "&#123;{").replace(/\}\}/g, "}&#125;");
        pos = tag.index + tag[0].length;
    }
    result += prose(text.substring(pos));
    if (mode == "inline") return result.replace(/\s*\n\s*/g, " ");
    return result.replace(/(?:[ \t]*(?:<br\s*\/?>|\n)[ \t]*)+/gi, breaks => {
        const count = (breaks.match(/<br\s*\/?>|\n/gi) ?? []).length;
        return count >= 2 ? "\n\n" : "\n";
    });
}

function prose(text: string): string {
    let result = "";
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c == "*") result += "&#42;";
        else if (c == "`") result += "&#96;";
        else if (c == "~") result += "&#126;";
        else if (c == "\\") result += "&#92;";
        else if (c == "[") result += "&#91;";
        else if (c == "]") result += "&#93;";
        else if (c == "_" && !(/\w/.test(text[i - 1] ?? "") && /\w/.test(text[i + 1] ?? ""))) result += "&#95;";
        // A { here has no }, so Quest shows it, and the rest of the text, as it is
        else if (c == "{") result += "&#123;";
        else if (c == "}") result += "&#125;";
        else result += c;
    }
    return result;
}

// Lines that Markdown would read as a heading, list or quote, which in Quest are just text
export function escapeLineStarts(text: string): string {
    return text.split("\n").map(line => line
        .replace(/^(\s*)#/, "$1&#35;")
        .replace(/^(\s*)([-+])(\s)/, (_, space, c, after) => `${space}${c == "-" ? "&#45;" : "&#43;"}${after}`)
        .replace(/^(\s*\d+)\.(\s)/, "$1&#46;$2"),
    ).join("\n");
}

// Converts a gamebook's scripts into Squiffy text. A page's script runs before its text is shown,
// so it becomes text at the start of its section: msg becomes text, flags and counters become
// {{set}}, {{inc}} and {{dec}}, if becomes {{#if}}, and MovePlayer becomes {{goto}}. The helpers
// run in order as the text is shown, so the page's text and links see what the script changed.

import { display, print, quote, randomInteger, Unconvertible } from "../twine/expression.js";
import type { BinaryOp, Expr } from "../twine/expression.js";
import { sectionLink, urlLink } from "../twine/convert.js";
import type { QExpr, QStmt } from "./script.js";
import { convertQuestText, objectAttribute } from "./text.js";
import type { TextContext } from "./text.js";

export interface ScriptContext extends TextContext {
    // The Quest page whose script this is, or undefined for the game's script that runs on every
    // page
    readonly page?: string;
    // Whether this is a GetInput callback, where result is what the player typed
    readonly inCallback?: boolean;
    // Whether a name is one of the game's pages
    isPage(name: string): boolean;
    // The attribute for a link a script adds or removes, and the value that shows it with some text
    linkAttribute(source: string, destination: string): string;
    linkValue(source: string, destination: string, text: string): Expr;
    // A new attribute, for a firsttime that isn't at the top of a page's script
    newFirstTime(): string;
    // A stylesheet the game uses, from changes to its look in a script, such as SetFontName
    noteStyle(): void;
    // Adds a section for what happens after the player types something, returning its name.
    // Squiffy keeps what's typed in an attribute once the player goes to another section.
    continueSection?(content: string): string;
}

export interface ConvertedScript {
    // @clear, if the script clears the screen before it shows anything
    directives: string[];
    lines: string[];
}

// The attribute that a GetInput callback's result goes in
export const INPUT_ATTRIBUTE = "input";

export function convertScript(statements: QStmt[], ctx: ScriptContext): ConvertedScript {
    const converter = new Converter(ctx);
    const lines = converter.statements(statements, true);
    return { directives: converter.directives, lines };
}

class Converter {
    readonly directives: string[] = [];
    // Whether anything has been shown yet, so a ClearScreen can be @clear
    private shown = false;

    constructor(private readonly ctx: ScriptContext) {}

    statements(statements: QStmt[], topLevel: boolean): string[] {
        const lines: string[] = [];
        for (const s of statements) {
            try {
                lines.push(...this.statement(s, topLevel));
            }
            catch (e) {
                if (!(e instanceof Unconvertible)) throw e;
                lines.push(this.ctx.unconvertible(s.src, `This couldn't be converted: ${e.message}.`));
            }
        }
        return lines;
    }

    private show(lines: string[]): string[] {
        this.shown = true;
        return lines;
    }

    private statement(s: QStmt, topLevel: boolean): string[] {
        switch (s.k) {
            case "raw":
                throw new Unconvertible("Squiffy couldn't read this Quest script");
            case "if": {
                // Each part is converted first, so if one can't be, the whole if is kept as it was
                const conditions = s.branches.map(b => print(this.expr(b.cond)));
                const lines: string[] = [];
                s.branches.forEach((b, i) => {
                    lines.push(i == 0 ? `{{#if ${conditions[i]}}}` : `{{else if ${conditions[i]}}}`);
                    lines.push(...this.statements(b.body, false));
                });
                if (s.otherwise) lines.push("{{else}}", ...this.statements(s.otherwise, false));
                lines.push("{{/if}}");
                return lines;
            }
            case "firsttime": {
                // At the top of a page's script, it's the first time the page is shown. Anywhere
                // else, an attribute remembers whether it's run.
                const lines: string[] = [];
                if (topLevel && this.ctx.page !== undefined && !this.ctx.inCallback) {
                    lines.push(`{{#if (visits ${quote(this.ctx.section)}) = 1}}`, ...this.statements(s.body, false));
                }
                else {
                    const attribute = this.ctx.newFirstTime();
                    lines.push(`{{#unless ${attribute}}}`, `{{set ${quote(attribute)} true}}`, ...this.statements(s.body, false));
                }
                if (s.otherwise) lines.push("{{else}}", ...this.statements(s.otherwise, false));
                lines.push(topLevel && this.ctx.page !== undefined && !this.ctx.inCallback ? "{{/if}}" : "{{/unless}}");
                return lines;
            }
            case "switch": {
                const value = this.expr(s.value);
                const conditions = s.cases.map(c => print(c.values.map(v => ({ k: "bin", op: "=", l: value, r: this.expr(v) }) as Expr)
                    .reduce((a, b) => ({ k: "bin", op: "or", l: a, r: b }))));
                if (!s.cases.length) return s.otherwise ? this.statements(s.otherwise, false) : [];
                const lines: string[] = [];
                s.cases.forEach((c, i) => {
                    lines.push(i == 0 ? `{{#if ${conditions[i]}}}` : `{{else if ${conditions[i]}}}`);
                    lines.push(...this.statements(c.body, false));
                });
                if (s.otherwise) lines.push("{{else}}", ...this.statements(s.otherwise, false));
                lines.push("{{/if}}");
                return lines;
            }
            case "assign":
                return this.assign(s.target, s.value);
            case "call":
                return this.call(s, topLevel);
        }
    }

    private assign(target: QExpr, value: QExpr): string[] {
        if (target.k != "path") throw new Unconvertible("an assignment to something that isn't an attribute");
        const parts = target.parts;
        if (parts.length == 2 && parts[0] == "player" && parts[1] == "parent") return this.goto(value);
        if (parts.length == 1 && parts[0] == "this") throw new Unconvertible("this isn't an attribute");
        return [`{{set ${quote(this.attributeFor(parts))} ${print(this.expr(value))}}}`];
    }

    // The Squiffy attribute for a Quest attribute, or a variable in the script
    private attributeFor(parts: string[]): string {
        if (parts.length == 1) {
            if (this.ctx.inCallback && parts[0] == "result") return INPUT_ATTRIBUTE;
            if (this.ctx.isPage(parts[0]) || parts[0] == "game" || parts[0] == "player") throw new Unconvertible(`${parts[0]} isn't an attribute`);
            return this.ctx.attribute(parts[0]);
        }
        if (parts.length == 2) {
            const [object, attribute] = parts;
            if (object == "game") return this.ctx.attribute(attribute);
            if (object == "player" || this.ctx.isPage(object)) return this.ctx.attribute(objectAttribute(object, attribute));
            throw new Unconvertible(`there's nothing called "${object}" in the game`);
        }
        throw new Unconvertible(`Squiffy can't read ${parts.join(".")}`);
    }

    // Moving to a page. In Quest, moving to the page the player is already on does nothing, so the
    // script that runs on every page only goes somewhere if it's somewhere else.
    private goto(page: QExpr): string[] {
        let section: Expr;
        // A page kept in an attribute, such as game.next = Page2, is the name of its section
        if (page.k == "path" && page.parts.length > 1 && page.parts.join(".") != "player.parent") {
            section = this.expr(page);
        }
        else {
            const name = this.page(page);
            const target = this.ctx.target(name);
            if (!target) throw new Unconvertible(`there's no page called "${name}"`);
            if ("url" in target) throw new Unconvertible("moving to a link page");
            if (name == this.ctx.page) return [];
            section = { k: "str", v: target.section };
        }
        const goto = `{{goto ${print(section)}}}`;
        if (this.ctx.page !== undefined && section.k == "str") return [goto];
        return [`{{#unless ${print({ k: "call", fn: "at", args: [section] })}}}${goto}{{/unless}}`];
    }

    // The name of the page an expression refers to: Page2, player.parent, or GetObject ("Page2")
    private page(e: QExpr): string {
        if (e.k == "path" && e.parts.length == 1 && this.ctx.isPage(e.parts[0])) return e.parts[0];
        if (e.k == "path" && e.parts.join(".") == "player.parent" && this.ctx.page !== undefined) return this.ctx.page;
        // In a page's script, this is the page
        if (e.k == "path" && e.parts.length == 1 && e.parts[0] == "this" && this.ctx.page !== undefined) return this.ctx.page;
        if (e.k == "call" && e.fn == "GetObject" && e.args.length == 1 && e.args[0].k == "str" && this.ctx.isPage(e.args[0].v)) return e.args[0].v;
        if (e.k == "path" && e.parts.length == 1) throw new Unconvertible(`there's no page called "${e.parts[0]}"`);
        throw new Unconvertible("a page that's worked out as the game runs");
    }

    // A string argument that has to be fixed text, such as a flag's name
    private text(e: QExpr | undefined, what: string): string {
        if (e?.k != "str" || !e.v.trim()) throw new Unconvertible(`${what} that isn't fixed text`);
        return e.v;
    }

    private call(s: QStmt & { k: "call" }, topLevel: boolean): string[] {
        const ctx = this.ctx;
        const args = s.args;
        const set = (name: string, value: string) => [`{{set ${quote(ctx.attribute(name))} ${value}}}`];
        switch (s.fn) {
            case "msg":
            case "OutputText":
            case "OutputTextNoBr":
                return this.show([this.output(args[0])]);
            case "PrintCentered":
                // A span, so its text can have Markdown in it, as a div can't
                return this.show([`<span style="display: block; text-align: center">${this.output(args[0])}</span>`]);
            case "SetFlagOn":
                return set(this.text(args[0], "a flag"), "true");
            case "SetFlagOff":
                return set(this.text(args[0], "a flag"), "false");
            case "SetCounter":
                return set(this.text(args[0], "a counter"), print(this.expr(args[1])));
            case "IncreaseCounter":
                return [`{{inc ${quote(ctx.attribute(this.text(args[0], "a counter")))}}}`];
            case "DecreaseCounter":
                return [`{{dec ${quote(ctx.attribute(this.text(args[0], "a counter")))}}}`];
            case "ChangeCounter":
                return [`{{inc ${quote(ctx.attribute(this.text(args[0], "a counter")))} ${print(this.expr(args[1]))}}}`];
            case "set": {
                if (args.length != 3 || args[0].k != "path" || args[0].parts.length != 1) throw new Unconvertible("set with something other than an object, a name and a value");
                return this.assign({ k: "path", parts: [args[0].parts[0], this.text(args[1], "an attribute's name")] }, args[2]);
            }
            case "MovePlayer":
                if (args.length != 1) throw new Unconvertible("MovePlayer with no page");
                return this.goto(args[0]);
            case "AddPageLink":
            case "RemovePageLink": {
                if (args.length != (s.fn == "AddPageLink" ? 3 : 2)) throw new Unconvertible(`${s.fn} with the wrong number of values`);
                const source = this.page(args[0]);
                const destination = this.page(args[1]);
                const attribute = ctx.linkAttribute(source, destination);
                const value = s.fn == "AddPageLink" ? print(ctx.linkValue(source, destination, this.text(args[2], "a link's text"))) : "false";
                return [`{{set ${quote(attribute)} ${value}}}`];
            }
            case "ClearScreen":
                if (topLevel && !this.shown && !ctx.inCallback) {
                    if (!this.directives.includes("@clear")) this.directives.push("@clear");
                    return [];
                }
                throw new Unconvertible("Squiffy can only clear the screen before a section is shown");
            case "on ready":
                // Waits for anything still going on, such as a sound, before running the rest
                return this.statements(s.callback ?? [], topLevel);
            case "picture": {
                // Quest shows nothing for no picture, or no sound
                if (args[0]?.k == "str" && !args[0].v.trim()) return [];
                const file = this.text(args[0], "a picture");
                ctx.asset(file);
                return this.show([`<img src="${escapeAttribute(file)}" alt="">`]);
            }
            case "play sound": {
                if (args[0]?.k == "str" && !args[0].v.trim()) return [];
                const file = this.text(args[0], "a sound");
                ctx.asset(file);
                // A sound that loops is music, which carries on from one page to the next
                if (args[2]?.k == "bool" && args[2].v) {
                    this.ctx.approximate(s.src, "This sound loops, so it's been converted to music, which keeps playing from one page to the next until the story plays other music or stops it. In Quest, the sound stopped when the player went to another page, unless the last page with a sound was set to continue playing it.");
                    return [`{{music ${quote(file)}}}`];
                }
                return [`{{sound ${quote(file)}}}`];
            }
            case "stop sound":
                // Squiffy can only stop music: a sound that plays once plays to the end
                return ["{{stopmusic}}"];
            case "ShowYouTube":
                return this.show([`<iframe class="quest-youtube" width="560" height="315" src="https://www.youtube.com/embed/${encodeURIComponent(this.text(args[0], "a video"))}" allowfullscreen></iframe>`]);
            case "DisplayHttpLink": {
                // As Quest: the address's scheme is replaced with http or https
                const address = this.text(args[1], "a web address").replace(/^.*?:\/\//, "");
                const secure = args[2]?.k == "bool" && args[2].v;
                return this.show([urlLink(this.output(args[0]), `${secure ? "https" : "http"}://${address}`)]);
            }
            case "TextFX_Typewriter":
            case "TextFX_Unscramble": {
                if (s.fn == "TextFX_Unscramble") ctx.approximate(s.src, "Squiffy can't unscramble text, so it's typed out instead.");
                const speed = args[1]?.k == "num" ? ` interval=${args[1].v}` : "";
                return this.show([`{{#animate "typewriter"${speed}}}${this.output(args[0])}{{/animate}}`]);
            }
            case "SetBackgroundColour":
                return this.style(`--squiffy-background: ${cssValue(this.text(args[0], "a colour"))};`);
            case "SetForegroundColour":
                return this.style(`--squiffy-text: ${cssValue(this.text(args[0], "a colour"))};`);
            case "SetLinkColour":
                return this.style(`--squiffy-link: ${cssValue(this.text(args[0], "a colour"))}; --squiffy-link-hover: ${cssValue(this.text(args[0], "a colour"))};`);
            case "SetFontName":
                return this.style(`--squiffy-font-family: ${cssValue(this.text(args[0], "a font"))};`);
            case "SetWebFontName": {
                const font = this.text(args[0], "a font");
                const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, "+")}&display=swap`;
                return this.style(`--squiffy-font-family: "${font.replace(/["\\<>{};]/g, "")}";`, `@import url("${url}");`);
            }
            case "SetFontSize": {
                const size = this.expr(args[0]);
                if (size.k != "num") throw new Unconvertible("a font size that isn't a number");
                return this.style(`--squiffy-font-size: ${size.v}pt;`);
            }
            case "GetInput": {
                // The rest of the script runs in a section of its own, which shows the page's links
                // again, as they're still there in Quest
                if (!ctx.continueSection || ctx.inCallback) throw new Unconvertible("asking for input here");
                const callback = convertScript(s.callback ?? [], { ...ctx, inCallback: true });
                if (callback.directives.length) throw new Unconvertible("clearing the screen after asking for input");
                const section = ctx.continueSection(callback.lines.join("\n"));
                return this.show([`<input type="text" data-attribute="${INPUT_ATTRIBUTE}">`, sectionLink("Continue", section)]);
            }
        }
        if (s.fn.startsWith("JS")) throw new Unconvertible("Squiffy can't run Quest's JavaScript");
        throw new Unconvertible(`Squiffy has nothing like ${s.fn}`);
    }

    // A change to how the story looks, as a stylesheet in the story's text, which applies from
    // when it's shown
    private style(rule: string, imports = ""): string[] {
        this.ctx.noteStyle();
        return [`<style>${imports}:root { color-scheme: light; ${rule} }</style>`];
    }

    // The text a msg shows: Quest's text processor runs on it, and the values joined to it are
    // shown as they are
    private output(e: QExpr | undefined): string {
        if (!e) return "";
        const parts: QExpr[] = [];
        const flatten = (x: QExpr) => {
            if (x.k == "bin" && x.op == "+" && hasText(x)) {
                flatten(x.l);
                flatten(x.r);
            }
            else {
                parts.push(x);
            }
        };
        flatten(e);
        return parts.map(p => p.k == "str"
            ? convertQuestText(p.v, this.ctx, "block").replace(/\n+/g, m => m.length > 1 ? "<br><br>" : "<br>")
            : display(this.expr(p))).join("");
    }

    expr(e: QExpr): Expr {
        switch (e.k) {
            case "num": return { k: "num", v: e.v };
            case "str": return { k: "str", v: e.v };
            case "bool": return { k: "bool", v: e.v };
            case "null": return { k: "null" };
            case "not": return { k: "not", e: this.expr(e.e) };
            case "neg": return { k: "neg", e: this.expr(e.e) };
            case "path": {
                const parts = e.parts;
                if (parts.length == 2 && this.ctx.isPage(parts[0]) && parts[1] == "visited") return this.seen(parts[0]);
                // A page, or the current page, as a value is its section's name
                if (parts.join(".") == "player.parent") {
                    return this.ctx.page === undefined ? { k: "var", name: "_section" } : { k: "str", v: this.ctx.section };
                }
                if ((parts.length == 1 && this.ctx.isPage(parts[0])) || (parts.length == 1 && parts[0] == "this" && this.ctx.page !== undefined)) {
                    const target = this.ctx.target(this.page(e));
                    if (!target || !("section" in target)) throw new Unconvertible(`${parts[0]} isn't a page in the story`);
                    return { k: "str", v: target.section };
                }
                return { k: "var", name: this.attributeFor(parts) };
            }
            case "bin": {
                // player.parent = Page2: whether the player is on that page
                for (const [a, b] of [[e.l, e.r], [e.r, e.l]]) {
                    if ((e.op == "=" || e.op == "<>") && a.k == "path" && a.parts.join(".") == "player.parent") {
                        const target = this.ctx.target(this.page(b));
                        if (!target || !("section" in target)) throw new Unconvertible("comparing the current page with something that isn't a page");
                        const at: Expr = { k: "call", fn: "at", args: [{ k: "str", v: target.section }] };
                        return e.op == "=" ? at : { k: "not", e: at };
                    }
                }
                const ops: Record<string, BinaryOp> = {
                    "or": "or", "and": "and", "=": "=", "<>": "!=", "<": "<", ">": ">", "<=": "<=", ">=": ">=",
                    "+": "+", "-": "-", "*": "*", "/": "/", "%": "%",
                };
                const op = ops[e.op];
                if (!op) throw new Unconvertible(`Squiffy has nothing like ${e.op}`);
                return { k: "bin", op, l: this.expr(e.l), r: this.expr(e.r) };
            }
            case "call":
                return this.callExpr(e);
        }
    }

    private seen(page: string): Expr {
        const target = this.ctx.target(page);
        if (!target || !("section" in target)) throw new Unconvertible(`"${page}" isn't a page in the story`);
        return { k: "call", fn: "seen", args: [{ k: "str", v: target.section }] };
    }

    private callExpr(e: QExpr & { k: "call" }): Expr {
        const args = e.args;
        switch (e.fn) {
            case "GetBoolean":
            case "GetInt":
            case "GetDouble":
            case "GetString":
            case "GetAttribute": {
                if (args.length != 2 || args[0].k != "path" || args[0].parts.length != 1) throw new Unconvertible(`${e.fn} of something other than an object`);
                const object = args[0].parts[0];
                const attribute = this.text(args[1], "an attribute's name");
                if (attribute == "visited" && this.ctx.isPage(object)) return this.seen(object);
                return { k: "var", name: this.attributeFor([object, attribute]) };
            }
            case "HasSeenPage":
                if (args.length != 1) throw new Unconvertible("HasSeenPage with no page");
                return this.seen(this.page(args[0]));
            case "RandomChance": {
                const chance = args[0] ? this.expr(args[0]) : undefined;
                if (chance?.k != "num") throw new Unconvertible("a random chance that isn't a number");
                return randomChance(chance.v);
            }
            case "GetRandomInt":
                if (args.length != 2) throw new Unconvertible("GetRandomInt without two numbers");
                return randomInteger(this.expr(args[0]), this.expr(args[1]));
            case "GetFileURL": {
                const file = this.text(args[0], "a file");
                this.ctx.asset(file);
                return { k: "str", v: file };
            }
            case "ToString":
            case "ToInt":
            case "ToDouble":
                if (args.length != 1) throw new Unconvertible(`${e.fn} without one value`);
                return this.expr(args[0]);
        }
        throw new Unconvertible(`Squiffy has nothing like ${e.fn}`);
    }
}

function hasText(e: QExpr): boolean {
    if (e.k == "str") return true;
    if (e.k == "bin" && e.op == "+") return hasText(e.l) || hasText(e.r);
    return false;
}

// RandomChance(35): true 35% of the time, as a random pick from 1 to 20 being 7 or less
function randomChance(percent: number): Expr {
    if (percent <= 0) return { k: "bool", v: false };
    if (percent >= 100) return { k: "bool", v: true };
    const whole = Math.round(percent);
    const gcd = (a: number, b: number): number => b == 0 ? a : gcd(b, a % b);
    const divisor = gcd(whole, 100);
    return {
        k: "bin", op: "<=",
        l: randomInteger({ k: "num", v: 1 }, { k: "num", v: 100 / divisor }),
        r: { k: "num", v: whole / divisor },
    };
}

function escapeAttribute(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/\[/g, "&#91;").replace(/\]/g, "&#93;");
}

function cssValue(value: string): string {
    return value.replace(/[;{}<>]/g, "").trim();
}

// The pages a script adds links to or removes them from, with each link's text, so the pages can
// show them depending on an attribute
export function* linkChanges(statements: QStmt[], currentPage: string | undefined, isPage: (name: string) => boolean):
    Generator<{ source: string, destination: string, text?: string }> {
    const page = (e: QExpr | undefined): string | undefined => {
        if (e?.k == "path" && e.parts.length == 1 && isPage(e.parts[0])) return e.parts[0];
        if (e?.k == "path" && (e.parts.join(".") == "player.parent" || e.parts.join(".") == "this")) return currentPage;
        if (e?.k == "call" && e.fn == "GetObject" && e.args[0]?.k == "str" && isPage(e.args[0].v)) return e.args[0].v;
        return undefined;
    };
    for (const s of statements) {
        if (s.k == "call") {
            if ((s.fn == "AddPageLink" && s.args.length == 3) || (s.fn == "RemovePageLink" && s.args.length == 2)) {
                const source = page(s.args[0]);
                const destination = page(s.args[1]);
                if (source !== undefined && destination !== undefined) {
                    const text = s.fn == "AddPageLink" && s.args[2].k == "str" ? s.args[2].v : undefined;
                    yield { source, destination, text };
                }
            }
            if (s.callback) yield* linkChanges(s.callback, currentPage, isPage);
        }
        else if (s.k == "if") {
            for (const b of s.branches) yield* linkChanges(b.body, currentPage, isPage);
            if (s.otherwise) yield* linkChanges(s.otherwise, currentPage, isPage);
        }
        else if (s.k == "firsttime") {
            yield* linkChanges(s.body, currentPage, isPage);
            if (s.otherwise) yield* linkChanges(s.otherwise, currentPage, isPage);
        }
        else if (s.k == "switch") {
            for (const c of s.cases) yield* linkChanges(c.body, currentPage, isPage);
            if (s.otherwise) yield* linkChanges(s.otherwise, currentPage, isPage);
        }
    }
}

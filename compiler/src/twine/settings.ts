// SugarCube's player settings (#452), from the story's JavaScript: Setting.addToggle(),
// Setting.addList() and Setting.addRange() become squiffy.json's "settings". The story reads them
// as settings.name, as in SugarCube. Their onInit and onChange functions can't come with them, as
// they're JavaScript written for SugarCube, but each setting puts classes on the story's element,
// which the stylesheet can use instead.
//
// Only literal values are read: text, numbers, true and false, lists of those, and a list held in a
// variable the script sets to one, as in `var settingFontSize = ["100%", "125%"]`.

import type { PlayerSetting, PlayerSettingOption } from "../project.js";

export interface SettingsProblem {
    text: string;
    reason: string;
}

// A value from the script: one Squiffy can use, a name (such as a variable), or code it can't
type Literal = string | number | boolean | null | Literal[] | { [key: string]: Literal } | { code: string } | { name: string };

const isCode = (v: Literal): v is { code: string } => !!v && typeof v == "object" && !Array.isArray(v) && "code" in v && Object.keys(v).length == 1;
const isName = (v: Literal): v is { name: string } => !!v && typeof v == "object" && !Array.isArray(v) && "name" in v && Object.keys(v).length == 1;

export function sugarCubeSettings(script: string): { settings: PlayerSetting[], problems: SettingsProblem[] } {
    const settings: PlayerSetting[] = [];
    const problems: SettingsProblem[] = [];
    const calls = /\bSetting\s*\.\s*add(Toggle|List|Range|Header|Value)\s*\(/g;
    for (const match of script.matchAll(calls)) {
        const kind = match[1];
        const start = match.index! + match[0].length;
        let args: Literal[];
        try {
            args = new LiteralParser(script, start).arguments();
        }
        catch {
            problems.push({ text: `Setting.add${kind}()`, reason: "This setting couldn't be read, so it isn't in Squiffy's Settings dialog." });
            continue;
        }
        // How the import report names it
        const callText = typeof args[0] == "string" ? `Setting.add${kind}(${JSON.stringify(args[0])})` : `Setting.add${kind}()`;
        if (kind == "Header" || kind == "Value") {
            if (kind == "Header") problems.push({ text: callText, reason: "Squiffy's Settings dialog has no headings, so this has been left out." });
            continue;
        }
        const [name, options] = args;
        if (typeof name != "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            problems.push({ text: callText, reason: "A setting's name in Squiffy is letters, digits and underscores, so this has been left out." });
            continue;
        }
        if (settings.some(s => s.name == name)) continue;
        const o = options && typeof options == "object" && !Array.isArray(options) && !isCode(options) && !isName(options)
            ? options as Record<string, Literal> : {};
        const label = typeof o.label == "string" && o.label.trim() ? stripHtml(o.label) : name;
        const description = typeof o.desc == "string" && o.desc.trim() ? stripHtml(o.desc) : undefined;
        const base = { name, label, ...(description ? { description } : {}) };

        if (kind == "Toggle") {
            settings.push({ ...base, type: "toggle", ...(typeof o.default == "boolean" ? { default: o.default } : {}) });
        }
        else if (kind == "List") {
            const list = isName(o.list) ? arrayNamed(script, o.list.name) : o.list;
            const options = Array.isArray(list) ? list.map(optionOf) : null;
            if (!options?.length || options.some(option => !option)) {
                problems.push({ text: callText, reason: "This setting's list of options couldn't be read, so it isn't in Squiffy's Settings dialog." });
                continue;
            }
            const unique = (options as PlayerSettingOption[]).filter((option, i, all) => all.findIndex(o => o.value == option.value) == i);
            const defaultValue = o.default === undefined || o.default === null ? undefined : String(o.default);
            settings.push({
                ...base, type: "list", options: unique,
                ...(defaultValue !== undefined && unique.some(option => option.value == defaultValue) ? { default: defaultValue } : {}),
            });
        }
        else {
            const { min, max, step } = o;
            if (typeof min != "number" || typeof max != "number" || min > max) {
                problems.push({ text: callText, reason: "This setting's min and max couldn't be read, so it isn't in Squiffy's Settings dialog." });
                continue;
            }
            settings.push({
                ...base, type: "range", min, max,
                ...(typeof step == "number" && step > 0 ? { step } : {}),
                ...(typeof o.default == "number" && o.default >= min && o.default <= max ? { default: o.default } : {}),
            });
        }

        if (o.onInit !== undefined || o.onChange !== undefined) {
            const setting = settings[settings.length - 1];
            const example = setting.type == "toggle" ? `setting-${name}`
                : setting.type == "list" ? `setting-${name}-${setting.options[0].value.replace(/[^A-Za-z0-9_-]+/g, "-")}`
                    : `setting-${name}-${setting.default ?? setting.min}`;
            problems.push({
                text: callText,
                reason: `This setting's onInit and onChange are SugarCube JavaScript, which Squiffy doesn't run. The setting puts a class on the story's element instead, such as ${example}, which the stylesheet can use.`,
            });
        }
    }
    return { settings, problems };
}

function optionOf(item: Literal): PlayerSettingOption | null {
    if (typeof item == "string" && item.trim()) return { value: item, label: item };
    if (typeof item == "number" || typeof item == "boolean") return { value: String(item), label: String(item) };
    return null;
}

const stripHtml = (text: string) => text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

// The list a variable is set to in the script, e.g. var sizes = ["Small", "Large"], or
// setup.sizes = [...]
function arrayNamed(script: string, name: string): Literal | undefined {
    const escaped = name.replace(/[.$]/g, m => "\\" + m);
    const declaration = new RegExp(`(?:\\b(?:var|let|const)\\s+|(?<![\\w.$]))${escaped}\\s*=\\s*(?=\\[)`, "g");
    const match = declaration.exec(script);
    if (!match) return undefined;
    try {
        return new LiteralParser(script, match.index + match[0].length).value(false);
    }
    catch {
        return undefined;
    }
}

// Reads JavaScript literals from a script. Anything else, such as a function, is skipped over and
// kept as code, so the arguments around it can still be read.
class LiteralParser {
    constructor(private s: string, private i: number) {}

    // A call's arguments, up to its closing bracket
    arguments(): Literal[] {
        const args: Literal[] = [];
        this.space();
        if (this.accept(")")) return args;
        do {
            this.space();
            if (this.peek() == ")") break;
            args.push(this.value());
            this.space();
        } while (this.accept(","));
        this.expect(")");
        return args;
    }

    // A value, which is code if there's more to it, e.g. a sum. In a statement (not wholeExpression),
    // what comes after it isn't looked at.
    value(wholeExpression = true): Literal {
        this.space();
        const c = this.peek();
        const start = this.i;
        let v: Literal;
        if (c == "\"" || c == "'" || c == "`") v = this.string();
        else if (c == "[") v = this.array();
        else if (c == "{") v = this.object();
        else if (/[-+\d.]/.test(c) && /^[-+]?(\d|\.\d)/.test(this.s.substring(this.i, this.i + 3))) v = this.number();
        else {
            const word = /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*/.exec(this.s.substring(this.i));
            if (word && !["function", "async", "new"].includes(word[0])) {
                this.i += word[0].length;
                const name = word[0].replace(/\s+/g, "");
                v = name == "true" ? true : name == "false" ? false : name == "null" || name == "undefined" ? null : { name };
            }
            else v = { code: "" };
        }
        // Anything more, e.g. an arrow function's body or a sum, makes it code
        if (!wholeExpression && !isCode(v)) return v;
        this.space();
        if (!this.atEnd()) {
            this.skipExpression();
            return { code: this.s.substring(start, this.i) };
        }
        return v;
    }

    private atEnd() {
        const c = this.peek();
        return c == "," || c == ")" || c == "]" || c == "}" || c == "";
    }

    // Skips to the end of the expression: the next comma or closing bracket outside any brackets
    private skipExpression() {
        let depth = 0;
        while (this.i < this.s.length) {
            const c = this.peek();
            if (c == "\"" || c == "'" || c == "`") {
                this.string();
                continue;
            }
            if (c == "/" && (this.s[this.i + 1] == "/" || this.s[this.i + 1] == "*")) {
                this.space();
                continue;
            }
            if (c == "(" || c == "[" || c == "{") depth++;
            else if (c == ")" || c == "]" || c == "}") {
                if (depth == 0) return;
                depth--;
            }
            else if (c == "," && depth == 0) return;
            this.i++;
        }
        throw new Error("Unfinished expression");
    }

    private string(): string | { code: string } {
        const quote = this.s[this.i++];
        let out = "";
        let template = false;
        while (this.i < this.s.length) {
            const c = this.s[this.i++];
            if (c == quote) return template ? { code: out } : out;
            if (c == "\\") {
                const e = this.s[this.i++];
                out += e == "n" ? "\n" : e == "t" ? "\t" : e;
            }
            else {
                if (quote == "`" && c == "$" && this.s[this.i] == "{") template = true;
                out += c;
            }
        }
        throw new Error("Unfinished string");
    }

    private number(): number {
        const match = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i.exec(this.s.substring(this.i))!;
        this.i += match[0].length;
        return Number(match[0]);
    }

    private array(): Literal[] {
        this.expect("[");
        const items: Literal[] = [];
        this.space();
        while (!this.accept("]")) {
            items.push(this.value());
            this.space();
            if (!this.accept(",")) {
                this.expect("]");
                break;
            }
            this.space();
        }
        return items;
    }

    private object(): Record<string, Literal> {
        this.expect("{");
        const result: Record<string, Literal> = {};
        this.space();
        while (!this.accept("}")) {
            const c = this.peek();
            let key: string;
            if (c == "\"" || c == "'") {
                const k = this.string();
                if (typeof k != "string") throw new Error("Bad key");
                key = k;
            }
            else {
                const word = /^[A-Za-z_$][\w$]*/.exec(this.s.substring(this.i));
                if (!word) throw new Error("Bad key");
                key = word[0];
                this.i += key.length;
            }
            this.space();
            if (this.accept(":")) {
                result[key] = this.value();
            }
            else if (this.peek() == "(") {
                // A method, e.g. onChange() { ... }
                const start = this.i;
                this.skipExpression();
                result[key] = { code: this.s.substring(start, this.i) };
            }
            else {
                // Shorthand, e.g. { list }
                result[key] = { name: key };
            }
            this.space();
            if (!this.accept(",")) {
                this.expect("}");
                break;
            }
            this.space();
        }
        return result;
    }

    // Skips spaces and comments
    private space() {
        for (;;) {
            const rest = this.s.substring(this.i, this.i + 2);
            if (/^\s/.test(rest)) this.i++;
            else if (rest == "//") {
                const end = this.s.indexOf("\n", this.i);
                this.i = end < 0 ? this.s.length : end;
            }
            else if (rest == "/*") {
                const end = this.s.indexOf("*/", this.i + 2);
                this.i = end < 0 ? this.s.length : end + 2;
            }
            else return;
        }
    }

    private peek() {
        return this.s[this.i] ?? "";
    }

    private accept(c: string) {
        if (this.s[this.i] != c) return false;
        this.i++;
        return true;
    }

    private expect(c: string) {
        if (!this.accept(c)) throw new Error(`Expected ${c}`);
    }
}

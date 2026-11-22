import * as marked from "marked";
import Handlebars from "handlebars";
import { Section, Story, TagFilter } from "./types.js";
import { State } from "./state.js";
import { rewriteInfixExpressions, rewriteValueExpression, splitSetters } from "squiffy-compiler/infix-expressions";
import { isNumeric, isBlank, toNumber } from "./numbers.js";
import { checkSegment, parsePath, valueAt, withValueAt } from "./paths.js";
import { parseDelay } from "./utils.js";
import { captureEveryBodies } from "./every.js";
import { listPassages, listSections, tagsOf } from "./storyLists.js";

// The built-in effects for {{#style}} (#453), in squiffy.runtime.css
const styleEffects = new Set([
    "shake", "shudder", "rumble", "sway", "buoy", "pulse", "fade-in-out", "blink", "flicker",
    "blur", "blurrier", "smear", "mirror", "upside-down",
    "shadow", "emboss", "outline", "condense", "expand", "tall", "flat",
    "double-underline", "wavy-underline", "double-strike", "wavy-strike",
]);

// An embed being shown (#450): its parameters, and the text it wraps, if any
interface EmbedScope {
    params: Record<string, unknown>;
    content?: () => string;
}

// The comment {{clear}} writes (#524)
export const CLEAR_MARKER = "squiffy-clear";

// What's left of html once everything before its last {{clear}} is taken out, or null if it has none
export function afterClear(html: string): string | null {
    if (!html.includes(`<!--${CLEAR_MARKER}-->`)) return null;
    const template = document.createElement("template");
    template.innerHTML = html;
    // 128: NodeFilter.SHOW_COMMENT
    const walker = document.createTreeWalker(template.content, 128);
    let last: ChildNode | null = null;
    while (walker.nextNode()) {
        if ((walker.currentNode as Comment).data == CLEAR_MARKER) last = walker.currentNode as ChildNode;
    }
    if (!last) return null;
    // Everything before it, at its own level and in each element it's inside, such as a paragraph
    for (let node: Node | null = last; node && node !== template.content; node = node.parentNode) {
        while (node.previousSibling) node.previousSibling.remove();
    }
    last.remove();
    return template.innerHTML.trim();
}

export class TextProcessor {
    getStory: () => Story;
    state: State;
    getCurrentSection: () => Section;
    handlebars: typeof Handlebars;

    constructor (story: () => Story,
                 state: State,
                 currentSection: () => Section) {
        this.getStory = story;
        this.state = state;
        this.getCurrentSection = currentSection;
        this.handlebars = Handlebars.create();

        // {{embed "name"}} shows a section's or passage's text here. It can be given parameters,
        // {{embed "say" who="Ann"}}, which the embedded text reads as {{who}} and which hide any
        // attribute with the same name, and it can wrap text, {{#embed "say"}}Hello!{{/embed}},
        // which the embedded text shows with {{content}} (#450).
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const processor = this;
        this.handlebars.registerHelper("embed", function (this: unknown, ...args: any[]) {
            const options = args.pop();
            const name = unwrapValue(args[0]);
            const text = processor.embeddedText(name);
            if (text === undefined) return;

            const params: Record<string, unknown> = Object.create(null);
            for (const [key, value] of Object.entries(options.hash ?? {})) params[key] = unwrapValue(value);

            // The wrapped text is filled in with the caller's attributes and parameters, not the
            // embedded text's, so it's shown with the scopes as they are here
            const callerScopes = processor.scopes;
            const content = options.fn
                ? () => {
                    const inner = processor.scopes;
                    processor.scopes = callerScopes;
                    try {
                        return options.fn(this, { data: options.data });
                    } finally {
                        processor.scopes = inner;
                    }
                }
                : undefined;

            processor.scopes = [...callerScopes, { params, content }];
            try {
                return new Handlebars.SafeString(processor.process(text, true));
            } finally {
                processor.scopes = callerScopes;
            }
        });

        // Inside an embed that wraps text, that text (#450). A story can have an attribute
        // called content, which {{content}} shows when there's no wrapped text.
        this.handlebars.registerHelper("content", () => {
            const scope = this.scopes[this.scopes.length - 1];
            if (scope?.content) return new Handlebars.SafeString(scope.content());
            if (this.hasAttribute("content")) return this.getAttribute("content");
            return "";
        });

        this.handlebars.registerHelper("seen", (name: string) => this.state.getSeen(name));
        this.handlebars.registerHelper("visits", (name: string) => this.state.getVisits(name));
        this.handlebars.registerHelper("get", (attribute: string) => this.getAttribute(attribute));
        this.handlebars.registerHelper("at", (section: string | string[]) => {
            const currentSection = this.getAttribute("_section");
            if (Array.isArray(section)) {
                return section.includes(currentSection);
            }
            return currentSection === section;
        });

        // Unwrap SafeString values from subexpressions, but keep lists and objects (#442)
        const unwrapValue = (value: any): any => {
            if (value && typeof value === "object" && typeof value.toHTML === "function") {
                return value.toString();
            }
            return value;
        };

        // {{goto "section"}} and {{goto "section" after=3000}} (#375): the runtime goes there once
        // the section or passage being shown has been written. Only the first one counts.
        this.handlebars.registerHelper("goto", (...args: any[]) => {
            const options = args.pop();
            const section = args.length ? unwrapValue(args[0]) : undefined;
            if (typeof section != "string" || !section || !(section in this.getStory().sections)) {
                return new Handlebars.SafeString(errorHtml("Error in {{goto}}:",
                    section === undefined ? "expected a section name, e.g. {{goto \"cave\"}}" : `there is no section called "${section}"`));
            }
            let after = 0;
            if (options.hash.after !== undefined) {
                // A number of milliseconds, or a time like "3s" (#451)
                const delay = parseDelay(unwrapValue(options.hash.after));
                if (delay === null) {
                    return new Handlebars.SafeString(errorHtml("Error in {{goto}}:",
                        `after= should be a number of milliseconds or a time, e.g. after=3000 or after="3s", not "${options.hash.after}"`));
                }
                after = delay;
            }
            this.goto ??= { section, after };
            return "";
        });

        // {{#every 1000}}...{{/every}} (#451): text that's shown again and again while the player
        // is in the section. This only writes the element: the runtime's timers show the text
        // (see every.ts), first after one delay, as in Twine.
        this.handlebars.registerHelper("every", (...args: any[]) => {
            const options = args.pop();
            const error = (message: string) => new Handlebars.SafeString(errorHtml("Error in {{#every}}:", message));
            const delay = args.length ? parseDelay(unwrapValue(args[0])) : null;
            if (delay === null || delay <= 0) {
                return error(`expected how often to show the text, as a number of milliseconds or a time, e.g. {{#every 1000}} or {{#every "1s"}}${args.length ? `, not "${args[0]}"` : ""}`);
            }
            const body = options.hash.__body;
            if (typeof options.fn != "function" || typeof body != "string") {
                return error("it needs some text to show, e.g. {{#every 1000}}Tick.{{/every}}");
            }
            let attrs = ` data-every="${body}" data-every-delay="${delay}" data-every-count="0"`;
            if (options.hash.times !== undefined) {
                const times = Number(unwrapValue(options.hash.times));
                if (!Number.isInteger(times) || times < 1) {
                    return error(`times= should be a whole number of times, e.g. times=10, not "${options.hash.times}"`);
                }
                attrs += ` data-every-times="${times}"`;
            }
            if (options.hash.append) attrs += " data-every-append=\"\"";
            // Text with paragraphs in it is a block, like {{#animate}}'s
            const tag = decodeURIComponent(body).includes("\n\n") ? "div" : "span";
            return new Handlebars.SafeString(`<${tag} class="squiffy-every"${attrs}></${tag}>`);
        });

        // {{clear}} (#524): like @clear, but it can be in an {{#if}}. It writes a comment that the
        // runtime finds once the text is rendered, and clears the screen before writing what comes after.
        this.handlebars.registerHelper("clear", () => new Handlebars.SafeString(`<!--${CLEAR_MARKER}-->`));

        // {{stop}} (#451): the {{#every}} whose text this is stops after this time
        this.handlebars.registerHelper("stop", () => {
            this.stopEvery = true;
            return "";
        });

        // {{deactivate "name"}} (#13): the runtime disables the links to that passage on the screen
        // once the section or passage being shown has been written. With no name, it's the passage
        // being shown, e.g. one with @repeat that the player is done with (#104).
        this.handlebars.registerHelper("deactivate", (...args: any[]) => {
            args.pop();
            const names = args.length ? args.map(unwrapValue) : [this.getAttribute("_passage")];
            for (const name of names) {
                if (typeof name != "string" || !name) {
                    return new Handlebars.SafeString(errorHtml("Error in {{deactivate}}:",
                        args.length ? "expected a passage name, e.g. {{deactivate \"door\"}}" : "{{deactivate}} with no passage name only works in a passage"));
                }
                const sectionPassages = this.getCurrentSection()?.passages;
                const masterPassages = this.getStory().sections[""]?.passages;
                if (!(sectionPassages && name in sectionPassages) && !(masterPassages && name in masterPassages)) {
                    return new Handlebars.SafeString(errorHtml("Error in {{deactivate}}:", `there is no passage called "${name}" in this section`));
                }
                this.deactivate.add(name);
            }
            return "";
        });

        // State modification helpers (side effects, no output)
        // These execute at render time, so they respect {{#if}} conditions
        this.handlebars.registerHelper("set", (attribute: string, value: any) => {
            this.setAttribute(attribute, unwrapValue(value));
            return "";
        });

        // Captures a value for evaluate()
        this.handlebars.registerHelper("__value", (value: unknown) => {
            this.evaluated = unwrapValue(value);
            return "";
        });

        this.handlebars.registerHelper("unset", (attribute: string) => {
            this.setAttribute(attribute, false);
            return "";
        });

        // {{inc "x"}} adds 1, and {{inc "x" amount}} adds the amount. Handlebars passes its options
        // object last, so the amount is there if there's anything before it.
        const incDecHelper = (name: string, sign: 1 | -1) => {
            this.handlebars.registerHelper(name, (attribute: string, ...args: any[]) => {
                const amount = args.length > 1 ? toNumber(name, unwrapValue(args[0])) : 1;
                const currentValue = toNumber(name, this.getAttribute(attribute));
                this.setAttribute(attribute, currentValue + sign * amount);
                return "";
            });
        };
        incDecHelper("inc", 1);
        incDecHelper("dec", -1);

        this.handlebars.registerHelper("and", (...args) => args.slice(0,-1).every(Boolean));
        this.handlebars.registerHelper("or",  (...args) => args.slice(0,-1).some(Boolean));
        this.handlebars.registerHelper("not", (v) => !v);
        this.handlebars.registerHelper("eq",  (a,b) => a == b);
        this.handlebars.registerHelper("ne",  (a,b) => a != b);
        this.handlebars.registerHelper("gt",  (a,b) => a >  b);
        this.handlebars.registerHelper("lt",  (a,b) => a <  b);
        this.handlebars.registerHelper("gte", (a,b) => a >= b);
        this.handlebars.registerHelper("lte", (a,b) => a <= b);
        // Maths helpers. These are what arithmetic in infix expressions is rewritten to,
        // e.g. {{set "gold" gold + price * 2}} -> {{set "gold" (add gold (mul price 2))}}
        const mathsHelper = (name: string, fn: (a: number, b: number) => number) => {
            this.handlebars.registerHelper(name, (...args) => {
                const values = args.slice(0, -1).map(unwrapValue);
                if (values.length !== 2) {
                    throw new Error(`"${name}" needs two values, but was given ${values.length}`);
                }
                return fn(toNumber(name, values[0]), toNumber(name, values[1]));
            });
        };
        // "add" joins text when either value isn't a number (or a string holding one),
        // so name + " the Brave" works, but an attribute holding "5" still adds as 5.
        this.handlebars.registerHelper("add", (...args) => {
            const values = args.slice(0, -1).map(unwrapValue);
            if (values.length !== 2) {
                throw new Error(`"add" needs two values, but was given ${values.length}`);
            }
            const [a, b] = values;
            if (isNumeric(a) && isNumeric(b)) {
                return toNumber("add", a) + toNumber("add", b);
            }
            const text = (v: any) => {
                if (isBlank(v)) return "";
                if (typeof v === "object") {
                    throw new Error(`"add" can't add ${Array.isArray(v) ? "a list" : "an object"}`);
                }
                return String(v);
            };
            return text(a) + text(b);
        });
        mathsHelper("sub", (a, b) => a - b);
        mathsHelper("mul", (a, b) => a * b);
        mathsHelper("div", (a, b) => {
            if (b === 0) throw new Error("division by zero");
            return a / b;
        });
        mathsHelper("mod", (a, b) => {
            if (b === 0) throw new Error("division by zero");
            return a % b;
        });

        // A story can have an attribute with the same name as a helper, such as count or min,
        // which {{count}} on its own would call the helper for, with no values. So the helpers
        // below that need values show the attribute instead, when there is one.
        // Rounding (#446). (round x) rounds to a whole number, and (round x 2) to 2 decimal places.
        // Numbers halfway between round up, as Math.round does, and as Harlowe's (round:) does.
        const roundingHelper = (name: string, fn: (n: number) => number, places: boolean) => {
            this.handlebars.registerHelper(name, (...args) => {
                const values = args.slice(0, -1).map(unwrapValue);
                if (values.length === 0 && this.hasAttribute(name)) return this.getAttribute(name);
                if (values.length !== 1 && !(places && values.length === 2)) {
                    throw new Error(`"${name}" needs ${places ? "one or two values" : "one value"}, but was given ${values.length}`);
                }
                const n = toNumber(name, values[0]);
                if (values.length === 1) return fn(n);
                const scale = 10 ** toNumber(name, values[1]);
                // toPrecision tidies up floating point errors, so (round 1.005 2) is 1.01, not 1
                return fn(Number((n * scale).toPrecision(15))) / scale;
            });
        };
        roundingHelper("round", Math.round, true);
        roundingHelper("floor", Math.floor, false);
        roundingHelper("ceil", Math.ceil, false);
        roundingHelper("abs", Math.abs, false);

        // (min a b c) or (min list): the smallest of the values
        const extremeHelper = (name: string, fn: (...values: number[]) => number) => {
            this.handlebars.registerHelper(name, (...args) => {
                let values = args.slice(0, -1).map(unwrapValue);
                if (values.length === 0 && this.hasAttribute(name)) return this.getAttribute(name);
                if (values.length === 1 && Array.isArray(values[0])) {
                    values = values[0].map(unwrapValue);
                }
                if (values.length === 0) {
                    throw new Error(`"${name}" needs at least one value`);
                }
                return fn(...values.map(v => toNumber(name, v)));
            });
        };
        extremeHelper("min", Math.min);
        extremeHelper("max", Math.max);

        // Text helpers (#446). A blank value (unset, false or "") is empty text, and a number
        // is turned into text.
        const toText = (name: string, v: unknown) => {
            if (isBlank(v)) return "";
            if (typeof v === "object") {
                throw new Error(`"${name}" needs text, but was given ${Array.isArray(v) ? "a list" : "an object"}`);
            }
            return String(v);
        };
        const textHelper = (name: string, fn: (s: string) => string) => {
            this.handlebars.registerHelper(name, (...args) => {
                const values = args.slice(0, -1).map(unwrapValue);
                if (values.length === 0 && this.hasAttribute(name)) return this.getAttribute(name);
                if (values.length !== 1) {
                    throw new Error(`"${name}" needs one value, but was given ${values.length}`);
                }
                return fn(toText(name, values[0]));
            });
        };
        textHelper("upper", s => s.toUpperCase());
        textHelper("lower", s => s.toLowerCase());
        const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.substring(1);
        textHelper("capitalise", capitalise);
        textHelper("capitalize", capitalise);

        // {{#once}}...{{else}}...{{/once}} shows its text the first time it's shown, and the
        // {{else}} text (or nothing) after that. Each one remembers for itself, wherever it is:
        // in a section or passage shown again, or in text embedded in several places. Which ones
        // have been shown is in _once, an attribute, so going back undoes it. One with a name,
        // {{#once "warning"}}, shares its memory with the others of that name. firsttime, as
        // Quest has it, is another name for once.
        const once = function (this: unknown, ...args: any[]) {
            const options = args.pop();
            if (typeof options?.fn != "function") {
                throw new Error("once wraps the text to show the first time: {{#once}}...{{/once}}");
            }
            const name = args.length ? unwrapValue(args[0]) : undefined;
            if (args.length && (typeof name != "string" || !name)) {
                throw new Error("the name of a {{#once}} is text, such as {{#once \"warning\"}}");
            }
            const key = name ?? processor.positionKey(options.loc);
            const shown: string[] = processor.state.get("_once") || [];
            if (shown.includes(key)) return options.inverse(this);
            processor.state.set("_once", [...shown, key]);
            return options.fn(this);
        };
        this.handlebars.registerHelper("once", once);
        this.handlebars.registerHelper("firsttime", once);

        // (cond test a b) is a if test is true, otherwise b (#446). It's what a ? b : c in an
        // expression is rewritten to. Handlebars works out both a and b before calling it, so a
        // helper with side effects, such as (pop "list"), runs whichever is chosen.
        this.handlebars.registerHelper("cond", (...args) => {
            const values = args.slice(0, -1).map(unwrapValue);
            if (values.length === 0 && this.hasAttribute("cond")) return this.getAttribute("cond");
            if (values.length !== 3) {
                throw new Error(`"cond" needs three values, but was given ${values.length}`);
            }
            return values[0] ? values[1] : values[2];
        });

        // a contains b in an expression (#446): whether list a has b in it, text a has the text b
        // in it, or object a has a property called b. Unlike (contains "list" value), which
        // looks up the list by its name, a here is the value itself.
        this.handlebars.registerHelper("__contains", (container: any, value: any) => {
            container = unwrapValue(container);
            value = unwrapValue(value);
            if (Array.isArray(container)) {
                return container.some(item => unwrapValue(item) === value);
            }
            if (isBlank(container)) return false;
            if (typeof container === "object") {
                return Object.prototype.hasOwnProperty.call(container, String(value));
            }
            return String(container).includes(toText("contains", value));
        });

        this.handlebars.registerHelper("array", function (...args) {
            args.pop(); // remove last argument - options
            return args.map(unwrapValue);
        });

        // An object literal in an expression, e.g. { hp: 10, name: "Ann" } (#442), which
        // compiler/src/infix-expressions.ts rewrites to (__object "hp" 10 "name" "Ann")
        this.handlebars.registerHelper("__object", (...args) => {
            args.pop();
            const result: Record<string, unknown> = {};
            for (let i = 0; i < args.length; i += 2) {
                const key = String(unwrapValue(args[i]));
                checkSegment(key);
                result[key] = unwrapValue(args[i + 1]);
            }
            return result;
        });

        // Array management helpers

        this.handlebars.registerHelper("append", (listVar: string, value: any) => {
            const currentArray = this.getAttribute(listVar) || [];
            const arr = Array.isArray(currentArray) ? [...currentArray] : [currentArray];
            const unwrappedValue = unwrapValue(value);
            if (Array.isArray(unwrappedValue)) {
                arr.push(...unwrappedValue.map(unwrapValue));
            } else {
                arr.push(unwrappedValue);
            }
            this.setAttribute(listVar, arr);
            return "";
        });

        this.handlebars.registerHelper("prepend", (listVar: string, value: any) => {
            const currentArray = this.getAttribute(listVar) || [];
            const arr = Array.isArray(currentArray) ? [...currentArray] : [currentArray];
            const unwrappedValue = unwrapValue(value);
            if (Array.isArray(unwrappedValue)) {
                arr.unshift(...unwrappedValue.map(unwrapValue));
            } else {
                arr.unshift(unwrappedValue);
            }
            this.setAttribute(listVar, arr);
            return "";
        });

        this.handlebars.registerHelper("pop", (listVar: string) => {
            const currentArray = this.getAttribute(listVar) || [];
            if (!Array.isArray(currentArray) || currentArray.length === 0) {
                return "";
            }
            const arr = [...currentArray];
            const item = arr.shift();
            this.setAttribute(listVar, arr);
            return item;
        });

        this.handlebars.registerHelper("remove", (listVar: string, value: any) => {
            const currentArray = this.getAttribute(listVar) || [];
            if (!Array.isArray(currentArray)) {
                return "";
            }
            const unwrappedValue = unwrapValue(value);
            const index = currentArray.findIndex(item => unwrapValue(item) === unwrappedValue);
            if (index !== -1) {
                const arr = [...currentArray];
                arr.splice(index, 1);
                this.setAttribute(listVar, arr);
            }
            return "";
        });

        this.handlebars.registerHelper("contains", (listOrVar: any, value: any) => {
            let arr: any[];
            if (typeof listOrVar === "string") {
                const stored = this.getAttribute(listOrVar);
                arr = Array.isArray(stored) ? stored : [];
            } else if (Array.isArray(listOrVar)) {
                arr = listOrVar;
            } else {
                return false;
            }
            const unwrappedValue = unwrapValue(value);
            return arr.some(item => unwrapValue(item) === unwrappedValue);
        });

        // The number of items in an array, or of values in an object
        this.handlebars.registerHelper("length", (...args: any[]) => {
            // The last argument is Handlebars' options
            if (args.length < 2) return 0;
            const listOrVar = args[0];
            const value = typeof listOrVar === "string" ? this.getAttribute(listOrVar) : listOrVar;
            if (Array.isArray(value)) return value.length;
            if (value && typeof value === "object" && !(value instanceof this.handlebars.SafeString)) return Object.keys(value).length;
            return 0;
        });

        // More helpers for lists (#447). These take the list itself, (join bag), not its name in
        // quotes as append and friends do, and give back a new list rather than changing the
        // attribute, so @set bag = (sort bag) sorts it. A blank value (unset, false or "") is
        // an empty list. Positions start at 0, as with bag[i] and {{@index}}.
        const toList = (name: string, v: unknown): unknown[] => {
            v = unwrapValue(v);
            if (Array.isArray(v)) return v.map(unwrapValue);
            if (isBlank(v)) return [];
            if (typeof v === "string") {
                throw new Error(`"${name}" needs a list, but was given the text "${v}". To use an attribute's list, leave out the quotes: (${name} bag), not (${name} "bag")`);
            }
            throw new Error(`"${name}" needs a list, but was given ${typeof v === "object" ? "an object" : String(v)}`);
        };
        const listHelper = (name: string, min: number, max: number, fn: (values: unknown[]) => unknown) => {
            this.handlebars.registerHelper(name, (...args) => {
                const values = args.slice(0, -1).map(unwrapValue);
                if (values.length === 0 && this.hasAttribute(name)) return this.getAttribute(name);
                if (values.length < min || values.length > max) {
                    const needs = min === max ? `${min} value${min === 1 ? "" : "s"}` : `${min} to ${max} values`;
                    throw new Error(`"${name}" needs ${needs}, but was given ${values.length}`);
                }
                return fn(values);
            });
        };
        // A whole number, for a position or a range
        const toWhole = (name: string, v: unknown) => Math.trunc(toNumber(name, v));

        // (join bag) is "lamp, key, rope", (join bag " / ") puts " / " between them, and
        // (join bag ", " " and ") is "lamp, key and rope"
        // As a block, {{#join bag ", " " and "}}...{{/join}} shows its text for each item, as
        // {{#each}} does (with this, @index, @first and @last), and puts the separators between
        // them, for lists of links (#525). {{else}} is shown for an empty list.
        const joinTexts = (items: string[], sep: string, lastSep: string | undefined) => {
            if (lastSep === undefined || items.length < 2) return items.join(sep);
            return items.slice(0, -1).join(sep) + lastSep + items[items.length - 1];
        };
        this.handlebars.registerHelper("join", function (this: unknown, ...args: any[]) {
            const options = args.pop();
            const values = args.map(unwrapValue);
            const block = typeof options?.fn === "function";
            if (!block && values.length === 0 && processor.hasAttribute("join")) return processor.getAttribute("join");
            if (values.length < 1 || values.length > 3) {
                throw new Error(`"join" needs 1 to 3 values, but was given ${values.length}`);
            }
            const [list, separator, lastSeparator] = values;
            const sep = separator === undefined ? ", " : toText("join", separator);
            const lastSep = lastSeparator === undefined ? undefined : toText("join", lastSeparator);
            const items = toList("join", list);
            if (!block) return joinTexts(items.map(item => toText("join", item)), sep, lastSep);

            if (items.length === 0) return options.inverse(this);
            const escape = Handlebars.Utils.escapeExpression;
            const texts = items.map((item, index) => {
                const data = Handlebars.createFrame(options.data ?? {});
                data.index = index;
                data.first = index === 0;
                data.last = index === items.length - 1;
                return String(options.fn(item, { data, blockParams: [item, index] }));
            });
            return joinTexts(texts, escape(sep), lastSep === undefined ? undefined : escape(lastSep));
        });

        // Numbers go before text, in order, and text is in alphabetical order, ignoring case,
        // with numbers inside it in order too ("item 2" before "item 10")
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
        listHelper("sort", 1, 1, ([list]) => toList("sort", list).sort((a, b) => {
            const aNum = typeof a === "number", bNum = typeof b === "number";
            if (aNum && bNum) return (a as number) - (b as number);
            if (aNum !== bNum) return aNum ? -1 : 1;
            return collator.compare(toText("sort", a), toText("sort", b));
        }));

        listHelper("shuffle", 1, 1, ([list]) => {
            const items = toList("shuffle", list);
            for (let i = items.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [items[i], items[j]] = [items[j], items[i]];
            }
            return items;
        });

        // (slice bag 1 3) is the items from position 1 up to, but not including, 3, and
        // (slice bag 1) is the rest from position 1. A negative position counts from the end,
        // so (slice bag -2) is the last two. It takes part of some text in the same way.
        listHelper("slice", 2, 3, ([container, start, end]) => {
            const from = toWhole("slice", start), to = end === undefined ? undefined : toWhole("slice", end);
            return typeof container === "string" ? container.slice(from, to) : toList("slice", container).slice(from, to);
        });

        // The first or last item, or nothing for an empty list
        listHelper("first", 1, 1, ([list]) => toList("first", list)[0] ?? "");
        listHelper("last", 1, 1, ([list]) => toList("last", list).slice(-1)[0] ?? "");

        // Where a value is in a list (from 0), or where some text is in text, or -1 if it isn't
        listHelper("indexof", 2, 2, ([container, value]) => {
            if (typeof container === "string") return container.indexOf(toText("indexof", value));
            return toList("indexof", container).indexOf(value);
        });

        // How many times a value is in a list, or some text is in text
        listHelper("count", 2, 2, ([container, value]) => {
            if (typeof container === "string") {
                const text = toText("count", value);
                return text === "" ? 0 : container.split(text).length - 1;
            }
            return toList("count", container).filter(item => item === value).length;
        });

        // (range 1 5) is the list 1, 2, 3, 4, 5, and (range 5 1) counts down
        listHelper("range", 2, 2, ([from, to]) => {
            const start = toWhole("range", from), end = toWhole("range", to);
            if (Math.abs(end - start) >= 10000) {
                throw new Error(`"range" can make a list of up to 10,000 numbers, but was asked for ${Math.abs(end - start) + 1}`);
            }
            const step = end >= start ? 1 : -1;
            const result: number[] = [];
            for (let n = start; n !== end + step; n += step) result.push(n);
            return result;
        });

        // (passages) lists the current section's passages and the master section's, (passages
        // "carriage") a section's ("" for the master section's), and (sections) the story's
        // sections, leaving out @1, @last and @after. tagged="passenger" lists only those with
        // that @tag, and untagged="settled" leaves out those with it. (tags "name") is a
        // passage's or section's tags (#527). Like the list helpers, with nothing given, they're
        // the attribute with the same name if there is one.
        const filterOf = (options: any): TagFilter => ({
            tagged: unwrapValue(options.hash?.tagged), untagged: unwrapValue(options.hash?.untagged),
        });
        const storyListHelper = (name: string, max: number, fn: (values: unknown[], options: any) => unknown) => {
            this.handlebars.registerHelper(name, (...args) => {
                const options = args.pop();
                const values = args.map(unwrapValue);
                if (!values.length && !Object.keys(options.hash ?? {}).length && this.hasAttribute(name)) return this.getAttribute(name);
                if (values.length > max) {
                    throw new Error(`"${name}" needs ${max ? `at most ${max} value` : "no values"}, but was given ${values.length}`);
                }
                return fn(values, options);
            });
        };
        storyListHelper("passages", 1, ([section], options) =>
            listPassages(this.getStory(), section === undefined ? undefined : String(section), this.getAttribute("_section"), filterOf(options)));
        storyListHelper("sections", 0, (_, options) => listSections(this.getStory(), filterOf(options)));
        storyListHelper("tags", 1, ([name]) => {
            const current = this.getAttribute("_section");
            return name === undefined ? [...(this.getStory().sections[current]?.tags ?? [])] : tagsOf(this.getStory(), String(name), current);
        });

        const escapeAttr = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");

        // A link's text and setters can have {{...}} in them, such as [[Drop the {{this}}]](drop,
        // item = "{{this}}") inside an {{#each}}. They're filled in where the link is, so they see
        // the loop's item. Setters aren't HTML, so their values aren't escaped.
        const linkTemplates = new Map<string, HandlebarsTemplateDelegate>();
        const fillIn = (text: unknown, context: unknown, options: any, escape: boolean) => {
            if (typeof text != "string" || !text.includes("{{")) return text;
            const key = (escape ? "h:" : "t:") + text;
            let template = linkTemplates.get(key);
            if (!template) {
                template = this.handlebars.compile(rewriteInfixExpressions(text), { compat: true, noEscape: !escape });
                linkTemplates.set(key, template);
            }
            return template(context, { data: options.data });
        };

        const addAdditionalParameters = (context: unknown, options: any) => {
            let result = "";
            const setters = fillIn(options.hash.set as string || "", context, options, false) as string;
            if (setters) {
                // With expressions, a setter can have commas inside quotes, e.g. greeting = "Hi, there"
                const list = this.getStory().expressions ? splitSetters(setters) : setters.split(",").map(s => s.trim());
                result += ` data-set="${escapeAttr(JSON.stringify(list))}"`;
            }
            return result;
        };

        // Handlebars passes the context a helper is used in (inside an {{#each}}, the item) as this
        this.handlebars.registerHelper("section", function (this: unknown, section: string, options) {
            const text = fillIn(options.hash.text as string || section, this, options, true);
            return new Handlebars.SafeString(`<a class="squiffy-link link-section" data-section="${escapeAttr(section)}"${addAdditionalParameters(this, options)} role="link" tabindex="0">${text}</a>`);
        });

        this.handlebars.registerHelper("passage", function (this: unknown, passage: string, options) {
            const text = fillIn(options.hash.text as string || passage, this, options, true);
            return new Handlebars.SafeString(`<a class="squiffy-link link-passage" data-passage="${escapeAttr(passage)}"${addAdditionalParameters(this, options)} role="link" tabindex="0">${text}</a>`);
        });

        // {{restart}} and {{saves}} (#452): links that restart the story, asking first unless
        // confirm=false, and open the Saved games dialog, like the page's own buttons
        this.handlebars.registerHelper("restart", function (this: unknown, options) {
            const text = fillIn(options.hash.text as string || processor.strings.restart, this, options, true);
            const confirm = options.hash.confirm === false || options.hash.confirm === "false" ? " data-confirm=\"false\"" : "";
            return new Handlebars.SafeString(`<a class="squiffy-link link-restart" data-handler="restart"${confirm} role="link" tabindex="0">${text}</a>`);
        });

        this.handlebars.registerHelper("saves", function (this: unknown, options) {
            const text = fillIn(options.hash.text as string || processor.strings.saves, this, options, true);
            return new Handlebars.SafeString(`<a class="squiffy-link link-saves" data-handler="saves" role="link" tabindex="0">${text}</a>`);
        });

        // {{settings}} (#452): a link that opens the Settings dialog, where the player changes the
        // story's settings (squiffy.json's "settings")
        this.handlebars.registerHelper("settings", function (this: unknown, options) {
            const text = fillIn(options.hash.text as string || processor.strings.settings, this, options, true);
            return new Handlebars.SafeString(`<a class="squiffy-link link-settings" data-handler="settings" role="link" tabindex="0">${text}</a>`);
        });

        // {{#style "warning"}}...{{/style}} (#453) gives the text it wraps one or more classes, for
        // the story's own CSS or the built-in effects (shudder, blur, ...: .squiffy-style.shudder
        // in squiffy.runtime.css). Text with blank lines in it is a block, so it gets a div.
        this.handlebars.registerHelper("style", function (this: unknown, ...args: any[]) {
            const options = args.pop();
            // String(): text that's only one helper, such as an {{#every}}, comes back as the helper's
            // SafeString
            const content = typeof options?.fn == "function" ? String(options.fn(this)) : "";
            const classes = args.flatMap(a => String(unwrapValue(a) ?? "").split(/\s+/)).filter(c => c.length > 0);
            // An element has one animation and one transform, so a second effect would replace the
            // first. Each effect after the first goes on an element of its own inside it, where
            // they add up.
            const extraEffects = classes.filter(c => styleEffects.has(c)).slice(1);
            const outer = classes.filter(c => !extraEffects.includes(c));
            const isBlock = content.includes("\n\n");
            const tag = isBlock ? "div" : "span";
            // The blank lines around a block's content let Markdown in it be rendered inside the div
            let html = isBlock ? `\n\n${content.trim()}\n\n` : content;
            for (const c of [...extraEffects].reverse()) {
                html = `<${tag} class="squiffy-style ${escapeAttr(c)}">${html}</${tag}>`;
            }
            return new Handlebars.SafeString(`<${tag} class="${escapeAttr(["squiffy-style", ...outer].join(" "))}">${html}</${tag}>`);
        });
    }

    // The default text of {{restart}}, {{saves}} and {{settings}} links, which the runtime sets
    // from the page's strings
    strings = { restart: "Restart", saves: "Saved games", settings: "Settings" };

    // Evaluates an expression, such as gold + price * 2, with the same rules and helpers as
    // {{#if}} and {{set}}. Throws if it isn't valid, or a helper fails.
    evaluate(expression: string): unknown {
        let template = this.expressionCache.get(expression);
        if (!template) {
            template = this.handlebars.compile(`{{__value ${rewriteValueExpression(expression)}}}`);
            this.expressionCache.set(expression, template);
        }
        this.evaluated = undefined;
        template(this.context());
        return this.evaluated;
    }

    // Where a {{goto}} asked to go. The runtime clears it before showing a section or passage, and
    // follows it afterwards.
    goto: { section: string; after: number } | null = null;
    // The passages whose links a {{deactivate}} asked to disable. Like goto, the runtime clears it
    // before showing a section or passage, and acts on it afterwards.
    deactivate = new Set<string>();
    // Set by a {{stop}} in an {{#every}}'s text (#451). The runtime clears it before showing the
    // text, and checks it afterwards.
    stopEvery = false;

    // The embeds being shown, innermost last (#450). Each embed's text sees its own parameters
    // and the story's attributes, but not the parameters of the embed it's inside.
    private scopes: EmbedScope[] = [];

    // The text {{embed "name"}} shows: a passage in the current section, or a section
    private embeddedText(name: unknown): string | undefined {
        if (typeof name != "string") return undefined;
        const currentSection = this.getCurrentSection();
        if (currentSection.passages && Object.prototype.hasOwnProperty.call(currentSection.passages, name)) {
            return currentSection.passages[name].text || "";
        }
        const story = this.getStory();
        if (Object.prototype.hasOwnProperty.call(story.sections, name)) {
            return story.sections[name].text || "";
        }
        return undefined;
    }

    // The parameters of the embed being shown, if any
    private get params(): Record<string, unknown> | undefined {
        return this.scopes[this.scopes.length - 1]?.params;
    }

    private isParam(attribute: string) {
        const params = this.params;
        return !!params && Object.prototype.hasOwnProperty.call(params, parsePath(attribute)[0]);
    }

    // Attributes, as the text being shown sees them: inside an embed, its parameters come first.
    // A name can be a path, such as hero.hp, as for State.
    hasAttribute(attribute: string) {
        return this.isParam(attribute) || this.state.has(attribute);
    }

    getAttribute(attribute: string): any {
        if (this.isParam(attribute)) {
            const [name, ...inside] = parsePath(attribute);
            return structuredClone(valueAt(this.params![name], inside));
        }
        return this.state.get(attribute);
    }

    // Setting a parameter changes it for the rest of that embed only. Anything else is the story's.
    setAttribute(attribute: string, value: any) {
        if (this.isParam(attribute)) {
            const [name, ...inside] = parsePath(attribute);
            if (typeof value === "undefined") value = true;
            this.params![name] = inside.length ? withValueAt(this.params![name], inside, name, value) : structuredClone(value);
            return;
        }
        this.state.set(attribute, value);
    }

    // What a template's names are looked up in: the story's attributes, with the parameters of
    // the embed being shown in front of them
    private context(): Record<string, any> {
        const store = this.state.getStore();
        const params = this.params;
        if (!params || !Object.keys(params).length) return store;
        const isParam = (prop: string | symbol) => typeof prop == "string" && Object.prototype.hasOwnProperty.call(params, prop);
        return new Proxy({} as Record<string, any>, {
            get: (_, prop) => isParam(prop) ? structuredClone(params[prop as string]) : Reflect.get(store, prop),
            has: (_, prop) => isParam(prop) || Reflect.has(store, prop),
            ownKeys: () => [...new Set([...Object.keys(params), ...Reflect.ownKeys(store)])],
            getOwnPropertyDescriptor: (_, prop) => isParam(prop)
                ? { enumerable: true, configurable: true, value: structuredClone(params[prop as string]) }
                : Reflect.getOwnPropertyDescriptor(store, prop),
        });
    }

    // The texts being processed, innermost last: a section's or passage's, and any it embeds
    private processing: string[] = [];

    // Identifies a place in the text being processed, for a {{#once}} to remember itself by: a
    // hash of the text, and where in it the block starts. A name that starts with a space can't
    // be the name an author gave one.
    private positionKey(loc?: { start: { line: number; column: number } }): string {
        const text = this.processing[this.processing.length - 1] ?? "";
        let hash = 5381;
        for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
        return ` ${hash.toString(36)}:${loc?.start.line ?? 0}:${loc?.start.column ?? 0}`;
    }

    private expressionCache = new Map<string, HandlebarsTemplateDelegate>();
    // Where the __value helper puts the value of the expression being evaluated
    private evaluated: unknown;

    process(text: string, inline: boolean) {
        this.processing.push(text);
        try {
            // compat: inside an {{#each}}, a name that isn't one of the item's looks for an attribute
            const template = this.handlebars.compile(rewriteInfixExpressions(captureEveryBodies(text)), { compat: true });
            text = template(this.context());

            if (inline) {
                return marked.parseInline(text, { async: false }).trim();
            }
            else {
                return marked.parse(text, { async: false }).trim();
            }
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error("Squiffy template error:", errorMessage);
            return errorHtml("Template error:", errorMessage);
        } finally {
            this.processing.pop();
        }
    }
}

// The block that shows an error in the story's output
export function errorHtml(label: string, message: string) {
    const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<div class="squiffy-error" style="color: red; background: #ffe0e0; padding: 8px; border: 1px solid red; margin: 4px 0; font-family: monospace; white-space: pre-wrap;"><strong>${escape(label)}</strong> ${escape(message)}</div>`;
}
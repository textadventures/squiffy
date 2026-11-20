import * as marked from "marked";
import Handlebars from "handlebars";
import { Section, Story } from "./types.js";
import { State } from "./state.js";
import { rewriteInfixExpressions, rewriteValueExpression, splitSetters } from "./infixExpressions.js";
import { isNumeric, isBlank, toNumber } from "./numbers.js";
import { checkSegment } from "./paths.js";

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

        this.handlebars.registerHelper("embed", (name: string) => {
            const currentSection = this.getCurrentSection();
            if (currentSection.passages && name in currentSection.passages) {
                return new Handlebars.SafeString(this.process(currentSection.passages[name].text || "", true));
            }
            const story = this.getStory();
            if (name in story.sections) {
                return new Handlebars.SafeString(this.process(story.sections[name].text || "", true));
            }
        });

        this.handlebars.registerHelper("seen", (name: string) => this.state.getSeen(name));
        this.handlebars.registerHelper("visits", (name: string) => this.state.getVisits(name));
        this.handlebars.registerHelper("get", (attribute: string) => this.state.get(attribute));
        this.handlebars.registerHelper("at", (section: string | string[]) => {
            const currentSection = this.state.get("_section");
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
                after = Number(unwrapValue(options.hash.after));
                if (!Number.isFinite(after) || after < 0) {
                    return new Handlebars.SafeString(errorHtml("Error in {{goto}}:",
                        `after= should be a number of milliseconds, e.g. after=3000, not "${options.hash.after}"`));
                }
            }
            this.goto ??= { section, after };
            return "";
        });

        // {{deactivate "name"}} (#13): the runtime disables the links to that passage on the screen
        // once the section or passage being shown has been written. With no name, it's the passage
        // being shown, e.g. one with @repeat that the player is done with (#104).
        this.handlebars.registerHelper("deactivate", (...args: any[]) => {
            args.pop();
            const names = args.length ? args.map(unwrapValue) : [this.state.get("_passage")];
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
            this.state.set(attribute, unwrapValue(value));
            return "";
        });

        // Captures a value for evaluate()
        this.handlebars.registerHelper("__value", (value: unknown) => {
            this.evaluated = unwrapValue(value);
            return "";
        });

        this.handlebars.registerHelper("unset", (attribute: string) => {
            this.state.set(attribute, false);
            return "";
        });

        // {{inc "x"}} adds 1, and {{inc "x" amount}} adds the amount. Handlebars passes its options
        // object last, so the amount is there if there's anything before it.
        const incDecHelper = (name: string, sign: 1 | -1) => {
            this.handlebars.registerHelper(name, (attribute: string, ...args: any[]) => {
                const amount = args.length > 1 ? toNumber(name, unwrapValue(args[0])) : 1;
                const currentValue = toNumber(name, this.state.get(attribute));
                this.state.set(attribute, currentValue + sign * amount);
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

        // Rounding (#446). (round x) rounds to a whole number, and (round x 2) to 2 decimal places.
        // Numbers halfway between round up, as Math.round does, and as Harlowe's (round:) does.
        const roundingHelper = (name: string, fn: (n: number) => number, places: boolean) => {
            this.handlebars.registerHelper(name, (...args) => {
                const values = args.slice(0, -1).map(unwrapValue);
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

        // (cond test a b) is a if test is true, otherwise b (#446). It's what a ? b : c in an
        // expression is rewritten to. Handlebars works out both a and b before calling it, so a
        // helper with side effects, such as (pop "list"), runs whichever is chosen.
        this.handlebars.registerHelper("cond", (...args) => {
            const values = args.slice(0, -1).map(unwrapValue);
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
        // infixExpressions.ts rewrites to (__object "hp" 10 "name" "Ann")
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
            const currentArray = this.state.get(listVar) || [];
            const arr = Array.isArray(currentArray) ? [...currentArray] : [currentArray];
            const unwrappedValue = unwrapValue(value);
            if (Array.isArray(unwrappedValue)) {
                arr.push(...unwrappedValue.map(unwrapValue));
            } else {
                arr.push(unwrappedValue);
            }
            this.state.set(listVar, arr);
            return "";
        });

        this.handlebars.registerHelper("prepend", (listVar: string, value: any) => {
            const currentArray = this.state.get(listVar) || [];
            const arr = Array.isArray(currentArray) ? [...currentArray] : [currentArray];
            const unwrappedValue = unwrapValue(value);
            if (Array.isArray(unwrappedValue)) {
                arr.unshift(...unwrappedValue.map(unwrapValue));
            } else {
                arr.unshift(unwrappedValue);
            }
            this.state.set(listVar, arr);
            return "";
        });

        this.handlebars.registerHelper("pop", (listVar: string) => {
            const currentArray = this.state.get(listVar) || [];
            if (!Array.isArray(currentArray) || currentArray.length === 0) {
                return "";
            }
            const arr = [...currentArray];
            const item = arr.shift();
            this.state.set(listVar, arr);
            return item;
        });

        this.handlebars.registerHelper("remove", (listVar: string, value: any) => {
            const currentArray = this.state.get(listVar) || [];
            if (!Array.isArray(currentArray)) {
                return "";
            }
            const unwrappedValue = unwrapValue(value);
            const index = currentArray.findIndex(item => unwrapValue(item) === unwrappedValue);
            if (index !== -1) {
                const arr = [...currentArray];
                arr.splice(index, 1);
                this.state.set(listVar, arr);
            }
            return "";
        });

        this.handlebars.registerHelper("contains", (listOrVar: any, value: any) => {
            let arr: any[];
            if (typeof listOrVar === "string") {
                const stored = this.state.get(listOrVar);
                arr = Array.isArray(stored) ? stored : [];
            } else if (Array.isArray(listOrVar)) {
                arr = listOrVar;
            } else {
                return false;
            }
            const unwrappedValue = unwrapValue(value);
            return arr.some(item => unwrapValue(item) === unwrappedValue);
        });

        this.handlebars.registerHelper("length", (listOrVar: any) => {
            let arr: any[];
            if (typeof listOrVar === "string") {
                const stored = this.state.get(listOrVar);
                arr = Array.isArray(stored) ? stored : [];
            } else if (Array.isArray(listOrVar)) {
                arr = listOrVar;
            } else {
                return 0;
            }
            return arr.length;
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
    }

    // Evaluates an expression, such as gold + price * 2, with the same rules and helpers as
    // {{#if}} and {{set}}. Throws if it isn't valid, or a helper fails.
    evaluate(expression: string): unknown {
        let template = this.expressionCache.get(expression);
        if (!template) {
            template = this.handlebars.compile(`{{__value ${rewriteValueExpression(expression)}}}`);
            this.expressionCache.set(expression, template);
        }
        this.evaluated = undefined;
        template(this.state.getStore());
        return this.evaluated;
    }

    // Where a {{goto}} asked to go. The runtime clears it before showing a section or passage, and
    // follows it afterwards.
    goto: { section: string; after: number } | null = null;
    // The passages whose links a {{deactivate}} asked to disable. Like goto, the runtime clears it
    // before showing a section or passage, and acts on it afterwards.
    deactivate = new Set<string>();

    private expressionCache = new Map<string, HandlebarsTemplateDelegate>();
    // Where the __value helper puts the value of the expression being evaluated
    private evaluated: unknown;

    process(text: string, inline: boolean) {
        try {
            // compat: inside an {{#each}}, a name that isn't one of the item's looks for an attribute
            const template = this.handlebars.compile(rewriteInfixExpressions(text), { compat: true });
            text = template(this.state.getStore());

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
        }
    }
}

// The block that shows an error in the story's output
export function errorHtml(label: string, message: string) {
    const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<div class="squiffy-error" style="color: red; background: #ffe0e0; padding: 8px; border: 1px solid red; margin: 4px 0; font-family: monospace; white-space: pre-wrap;"><strong>${escape(label)}</strong> ${escape(message)}</div>`;
}
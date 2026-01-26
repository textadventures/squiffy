import * as marked from "marked";
import Handlebars from "handlebars";
import { Section, Story } from "./types.js";
import { State } from "./state.js";

export class TextProcessor {
    story: Story;
    state: State;
    getCurrentSection: () => Section;
    handlebars: typeof Handlebars;

    constructor (story: Story,
                 state: State,
                 currentSection: () => Section) {
        this.story = story;
        this.state = state;
        this.getCurrentSection = currentSection;
        this.handlebars = Handlebars.create();

        this.handlebars.registerHelper("embed", (name: string) => {
            const currentSection = this.getCurrentSection();
            if (currentSection.passages && name in currentSection.passages) {
                return new Handlebars.SafeString(this.process(currentSection.passages[name].text || "", true));
            } else if (name in this.story.sections) {
                return new Handlebars.SafeString(this.process(this.story.sections[name].text || "", true));
            }
        });

        this.handlebars.registerHelper("seen", (name: string) => this.state.getSeen(name));
        this.handlebars.registerHelper("get", (attribute: string) => this.state.get(attribute));
        this.handlebars.registerHelper("at", (section: string | string[]) => {
            const currentSection = this.state.get("_section");
            if (Array.isArray(section)) {
                return section.includes(currentSection);
            }
            return currentSection === section;
        });

        // Unwrap SafeString values from subexpressions, but preserve arrays
        const unwrapValue = (value: any): any => {
            if (value && typeof value === "object" && typeof value.toString === "function" && !Array.isArray(value)) {
                return value.toString();
            }
            return value;
        };

        // State modification helpers (side effects, no output)
        // These execute at render time, so they respect {{#if}} conditions
        this.handlebars.registerHelper("set", (attribute: string, value: any) => {
            this.state.set(attribute, unwrapValue(value));
            return "";
        });

        this.handlebars.registerHelper("unset", (attribute: string) => {
            this.state.set(attribute, false);
            return "";
        });

        this.handlebars.registerHelper("inc", (attribute: string, options: any) => {
            const amount = typeof options === "number" ? options : 1;
            const currentValue = this.state.get(attribute) || 0;
            this.state.set(attribute, currentValue + amount);
            return "";
        });

        this.handlebars.registerHelper("dec", (attribute: string, options: any) => {
            const amount = typeof options === "number" ? options : 1;
            const currentValue = this.state.get(attribute) || 0;
            this.state.set(attribute, currentValue - amount);
            return "";
        });

        this.handlebars.registerHelper("and", (...args) => args.slice(0,-1).every(Boolean));
        this.handlebars.registerHelper("or",  (...args) => args.slice(0,-1).some(Boolean));
        this.handlebars.registerHelper("not", (v) => !v);
        this.handlebars.registerHelper("eq",  (a,b) => a == b);
        this.handlebars.registerHelper("ne",  (a,b) => a != b);
        this.handlebars.registerHelper("gt",  (a,b) => a >  b);
        this.handlebars.registerHelper("lt",  (a,b) => a <  b);
        this.handlebars.registerHelper("gte", (a,b) => a >= b);
        this.handlebars.registerHelper("lte", (a,b) => a <= b);
        this.handlebars.registerHelper("array", function (...args) {
            args.pop(); // remove last argument - options
            return args;
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

        const addAdditionalParameters = (options: any) => {
            let result = "";
            const setters = options.hash.set as string || "";
            if (setters) {
                result += ` data-set='${JSON.stringify(setters.split(",").map(s => s.trim()))}'`;
            }
            return result;
        };

        this.handlebars.registerHelper("section", (section: string, options) => {
            const text = options.hash.text as string || section;
            return new Handlebars.SafeString(`<a class="squiffy-link link-section" data-section="${section}"${addAdditionalParameters(options)} role="link" tabindex="0">${text}</a>`);
        });

        this.handlebars.registerHelper("passage", (passage: string, options) => {
            const text = options.hash.text as string || passage;
            return new Handlebars.SafeString(`<a class="squiffy-link link-passage" data-passage="${passage}"${addAdditionalParameters(options)} role="link" tabindex="0">${text}</a>`);
        });
    }

    process(text: string, inline: boolean) {
        try {
            const template = this.handlebars.compile(text);
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
            return `<div class="squiffy-error" style="color: red; background: #ffe0e0; padding: 8px; border: 1px solid red; margin: 4px 0; font-family: monospace; white-space: pre-wrap;"><strong>Template error:</strong> ${errorMessage}</div>`;
        }
    }
}
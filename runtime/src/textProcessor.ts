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

        // State modification helpers (side effects, no output)
        // These execute at render time, so they respect {{#if}} conditions
        this.handlebars.registerHelper("set", (attribute: string, value: any) => {
            this.state.set(attribute, value);
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
        const template = this.handlebars.compile(text);
        text = template(this.state.getStore());

        if (inline) {
            return marked.parseInline(text, { async: false }).trim();
        }
        else {
            return marked.parse(text, { async: false }).trim();
        }
    }
}
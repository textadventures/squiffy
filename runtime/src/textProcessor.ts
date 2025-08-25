import * as marked from 'marked';
import Handlebars from "handlebars";
import {Section, Story} from "./types.js";
import {State} from "./state.js";

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
                return this.process(currentSection.passages[name].text || '', true);
            } else if (name in this.story.sections) {
                return this.process(this.story.sections[name].text || '', true);
            }
        });

        this.handlebars.registerHelper("seen", (name: string) => this.state.getSeen(name));
        this.handlebars.registerHelper("get", (attribute: string) => this.state.get(attribute));
        this.handlebars.registerHelper('and', (...args) => args.slice(0,-1).every(Boolean));
        this.handlebars.registerHelper('or',  (...args) => args.slice(0,-1).some(Boolean));
        this.handlebars.registerHelper('not', (v) => !v);
        this.handlebars.registerHelper('eq',  (a,b) => a == b);
        this.handlebars.registerHelper('ne',  (a,b) => a != b);
        this.handlebars.registerHelper('gt',  (a,b) => a >  b);
        this.handlebars.registerHelper('lt',  (a,b) => a <  b);
        this.handlebars.registerHelper('gte', (a,b) => a >= b);
        this.handlebars.registerHelper('lte', (a,b) => a <= b);
        this.handlebars.registerHelper("label", (name: string, options) => {
            return new Handlebars.SafeString(`<span class="squiffy-label-${name}">${options.fn(this)}</span>`);
        });
        this.handlebars.registerHelper("array", function() {
            return Array.prototype.slice.call(arguments, 0, -1);
        });

        const addAdditionalParameters = (options: any) => {
            let result = '';
            const setters = options.hash.set as string || '';
            if (setters) {
                result += ` data-set='${JSON.stringify(setters.split(',').map(s => s.trim()))}'`;
            }
            const replacements = options.hash.replace as string || '';
            if (replacements) {
                result += ` data-replace='${JSON.stringify(replacements.split(',').map(s => s.trim()))}'`;
            }
            return result;
        }

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
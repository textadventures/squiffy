import {TextProcessor} from "./textProcessor.js";
import {SquiffyPlugin} from "./types.plugins.js";
import {State} from "./state.js";
import {LinkHandler} from "./linkHandler.js";

export class PluginManager {
    textProcessor: TextProcessor;
    state: State;
    linkHandler: LinkHandler;
    getSectionText: (name: string) => string | null;
    getPassageText: (name: string) => string | null;
    processText: (text: string, inline: boolean) => string;

    constructor(textProcessor: TextProcessor,
                state: State,
                linkHandler: LinkHandler,
                getSectionText: (name: string) => string | null,
                getPassageText: (name: string) => string | null,
                processText: (text: string, inline: boolean) => string) {
        this.textProcessor = textProcessor;
        this.state = state;
        this.linkHandler = linkHandler;
        this.getSectionText = getSectionText;
        this.getPassageText = getPassageText;
        this.processText = processText;
    }

    add(plugin: SquiffyPlugin) {
        return plugin.init({
            registerHelper: (name, helper) => {
                this.textProcessor.handlebars.registerHelper(name, helper);
            },
            registerLinkHandler: (type, handler) => {
                this.linkHandler.registerLinkHandler(type, handler);
            },
            get: (attribute) => this.state.get(attribute),
            set: (attribute, value) => this.state.set(attribute, value),
            getSectionText: this.getSectionText,
            getPassageText: this.getPassageText,
            processText: this.processText
        });
    }
}
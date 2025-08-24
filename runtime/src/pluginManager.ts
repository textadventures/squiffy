import {TextProcessor} from "./textProcessor.js";
import {SquiffyPlugin} from "./types.plugins.js";
import {State} from "./state.js";
import {LinkHandler} from "./linkHandler.js";

export class PluginManager {
    textProcessor: TextProcessor;
    state: State;
    linkHandler: LinkHandler;

    constructor(textProcessor: TextProcessor, state: State, linkHandler: LinkHandler) {
        this.textProcessor = textProcessor;
        this.state = state;
        this.linkHandler = linkHandler;
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
        });
    }
}
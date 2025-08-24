import {TextProcessor} from "./textProcessor.js";
import {SquiffyPlugin} from "./types.plugins.js";
import {State} from "./state.js";

export class PluginManager {
    textProcessor: TextProcessor;
    state: State;

    constructor(textProcessor: TextProcessor, state: State) {
        this.textProcessor = textProcessor;
        this.state = state;
    }

    add(plugin: SquiffyPlugin) {
        return plugin.init({
            registerHelper: (name, helper) => {
                this.textProcessor.handlebars.registerHelper(name, helper);
            },
            // registerLinkHandler: (type, handler) => {
            //     this.textProcessor.linkHandlers[type] = handler;
            // },
            get: (attribute) => this.state.get(attribute),
            set: (attribute, value) => this.state.set(attribute, value),
        });
    }
}
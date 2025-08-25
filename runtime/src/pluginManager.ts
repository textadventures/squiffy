import {TextProcessor} from "./textProcessor.js";
import {SquiffyPlugin} from "./types.plugins.js";
import {State} from "./state.js";
import {LinkHandler} from "./linkHandler.js";
import {Emitter, SquiffyEventMap} from "./events.js";

export class PluginManager {
    outputElement: HTMLElement;
    textProcessor: TextProcessor;
    state: State;
    linkHandler: LinkHandler;
    getSectionText: (name: string) => string | null;
    getPassageText: (name: string) => string | null;
    processText: (text: string, inline: boolean) => string;
    emitter: Emitter<SquiffyEventMap>;
    plugins: SquiffyPlugin[] = [];

    constructor(outputElement: HTMLElement,
                textProcessor: TextProcessor,
                state: State,
                linkHandler: LinkHandler,
                getSectionText: (name: string) => string | null,
                getPassageText: (name: string) => string | null,
                processText: (text: string, inline: boolean) => string,
                emitter: Emitter<SquiffyEventMap>) {
        this.outputElement = outputElement;
        this.textProcessor = textProcessor;
        this.state = state;
        this.linkHandler = linkHandler;
        this.getSectionText = getSectionText;
        this.getPassageText = getPassageText;
        this.processText = processText;
        this.emitter = emitter;
    }

    add(plugin: SquiffyPlugin) {
        const instance = plugin.init({
            outputElement: this.outputElement,
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
            processText: this.processText,
            on: (e, h) => this.emitter.on(e, h),
            off: (e, h) => this.emitter.off(e, h),
            once: (e, h) => this.emitter.once(e, h),
        });
        this.plugins.push(plugin);
        return instance;
    }

    onWrite(el: HTMLElement) {
        this.plugins.forEach(p => p.onWrite?.(el));
    }
}
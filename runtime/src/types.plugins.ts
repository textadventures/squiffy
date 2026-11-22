import type { HelperDelegate } from "handlebars";
import { SquiffyEventHandler, SquiffyEventMap } from "./events.js";
import { Animation } from "./animation.js";

export interface SquiffyPlugin {
    name: string;
    init(host: PluginHost): void | Promise<void>;
    onWrite?(el: HTMLElement): void;
    onLoad?(): void;
}

export interface HandleLinkResult {
    disableLink?: boolean;
}

export interface PluginHost {
    outputElement: HTMLElement;
    registerHelper(name: string, helper: HelperDelegate): void;
    registerLinkHandler(type: string, handler: (el: HTMLElement) => HandleLinkResult): void;
    get(attribute: string): any;
    set(attribute: string, value: any): void;
    getSectionText(name: string): string | null;
    getPassageText(name: string): string | null;
    processText: (text: string, inline: boolean) => string;
    // Rewrites asset URLs (src, srcset, poster, style url()) in already-rendered HTML using the
    // resolveAssetUrl init option. Use this for HTML a plugin inserts without going through
    // processText. Returns the HTML unchanged if no resolveAssetUrl was given.
    resolveAssetsInHtml: (html: string) => string;
    addTransition: (fn: () => Promise<void>) => void;
    // Runs the plugins' onWrite on HTML a plugin has put in the output itself, so that what's in
    // it works as it would in any other text, e.g. an {{#animate}} starts
    written: (el: HTMLElement) => void;
    animation: Animation;
    on<E extends keyof SquiffyEventMap>(
        event: E,
        handler: SquiffyEventHandler<E>
    ): () => void; // returns unsubscribe

    off<E extends keyof SquiffyEventMap>(
        event: E,
        handler: SquiffyEventHandler<E>
    ): void;

    once<E extends keyof SquiffyEventMap>(
        event: E,
        handler: SquiffyEventHandler<E>
    ): () => void;
}
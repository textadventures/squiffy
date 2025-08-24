import type { HelperDelegate } from "handlebars";

export interface SquiffyPlugin {
    name: string;
    init(host: PluginHost): void | Promise<void>;
}

export interface HandleLinkResult {
    disableLink?: boolean;
}

export interface PluginHost {
    registerHelper(name: string, helper: HelperDelegate): void;
    registerLinkHandler(type: string, handler: (el: HTMLElement) => HandleLinkResult): void;
    get(attribute: string): any;
    set(attribute: string, value: any): void;
}
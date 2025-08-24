import type { HelperDelegate } from "handlebars";

export interface SquiffyPlugin {
    name: string;
    init(host: PluginHost): void | Promise<void>;
}

export interface PluginHost {
    registerHelper(name: string, helper: HelperDelegate): void;
    // registerLinkHandler(type: string, handler: LinkHandler): void;
    get(attribute: string): any;
    set(attribute: string, value: any): void;
}
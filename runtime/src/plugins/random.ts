import { PluginHost, SquiffyPlugin } from "../types.plugins.js";
import Handlebars from "handlebars";
import type { SafeString } from "handlebars";

export function RandomPlugin() : SquiffyPlugin {
    return {
        name: "random",
        init(squiffy: PluginHost) {
            squiffy.registerHelper("random", (items: (string | SafeString)[], options) => {
                const stringItems = items.map(i => i.toString());
                const randomIndex = Math.floor(Math.random() * stringItems.length);
                const item = stringItems[randomIndex];

                const attribute = options.hash.set as string || "";
                if (attribute) {
                    squiffy.set(attribute, item);
                }
                return new Handlebars.SafeString(item);
            });
        }
    };
}
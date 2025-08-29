import {PluginHost, SquiffyPlugin} from "../types.plugins.js";
import Handlebars from "handlebars";
import {fadeReplace} from "../utils.js";

export function ReplaceLabel() : SquiffyPlugin {
    return {
        name: "replaceLabel",
        init(squiffy: PluginHost) {
            squiffy.registerHelper("label", (name: string, options) => {
                return new Handlebars.SafeString(`<span class="squiffy-label-${name}">${options.fn(this)}</span>`);
            });
            squiffy.registerHelper("replace", (name: string, options) => {
                const result = options.fn(this);
                const element = squiffy.outputElement.querySelector<HTMLElement>(`.squiffy-label-${name}`);
                if (element) {
                    squiffy.addTransition(() => fadeReplace(element, result))
                }
                return "";
            });
        }
    }
}
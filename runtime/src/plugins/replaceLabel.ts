import { PluginHost, SquiffyPlugin } from "../types.plugins.js";
import Handlebars from "handlebars";
import * as marked from "marked";
import { fadeReplace } from "../utils.js";

export function ReplaceLabel() : SquiffyPlugin {
    return {
        name: "replaceLabel",
        init(squiffy: PluginHost) {
            squiffy.registerHelper("label", function(name: string, options) {
                return new Handlebars.SafeString(`<span class="squiffy-label-${name}">${options.fn(this)}</span>`);
            });
            squiffy.registerHelper("replace", function(name: string, options) {
                const result = options.fn(this);
                const element = squiffy.outputElement.querySelector<HTMLElement>(`.squiffy-label-${name}`);
                if (element) {
                    const isBlock = result.includes("\n\n");
                    const html = isBlock
                        ? marked.parse(result, { async: false }).trim()
                        : marked.parseInline(result, { async: false }).trim();
                    squiffy.addTransition(() => fadeReplace(element, html as string));
                }
                return "";
            });
        }
    };
}
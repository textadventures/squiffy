import { PluginHost, SquiffyPlugin } from "../types.plugins.js";
import Handlebars from "handlebars";
import * as marked from "marked";
import { fadeReplace } from "../utils.js";

export function ReplaceLabel() : SquiffyPlugin {
    return {
        name: "replaceLabel",
        init(squiffy: PluginHost) {
            squiffy.registerHelper("label", function(this: any, name: string, options) {
                return new Handlebars.SafeString(`<span class="squiffy-label-${name}">${options.fn(this)}</span>`);
            });
            squiffy.registerHelper("replace", function(this: any, name: string, options) {
                // A block that's only another helper, such as {{#label}}, gives that helper's SafeString
                const result = String(options.fn(this));
                // The latest label with the name: when a section is visited again, or the screen's been
                // cleared, earlier ones can still be in the output (in the clear stack, hidden)
                const labels = squiffy.outputElement.querySelectorAll<HTMLElement>(`.squiffy-label-${name}`);
                const element = labels[labels.length - 1];
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
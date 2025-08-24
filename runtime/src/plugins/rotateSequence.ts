import {PluginHost, SquiffyPlugin} from "../types.plugins.js";
import {rotate} from "../utils.js";
import Handlebars from "handlebars";

const rotateSequence = (squiffy: PluginHost, type: string, items: string[], options: any) => {
    const rotation = rotate(items.join(':').replace(/"/g, '&quot;').replace(/'/g, '&#39;'), null);
    const attribute = options.hash.set as string || '';
    if (attribute) {
        squiffy.set(attribute, rotation[0]);
    }
    return new Handlebars.SafeString(`<a class="squiffy-link" data-${type}="${rotation[1]}" data-attribute="${attribute}" role="link">${rotation[0]}</a>`);
};

export const RotateSquencePlugin : SquiffyPlugin = {
    name: "rotateSequence",
    init(squiffy) {
        squiffy.registerHelper("rotate", (items: string[], options) =>
            rotateSequence(squiffy, "rotate", items, options));
        squiffy.registerHelper("sequence", (items: string[], options) =>
            rotateSequence(squiffy, "sequence", items, options));
    }
}
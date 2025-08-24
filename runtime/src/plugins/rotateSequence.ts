import {HandleLinkResult, PluginHost, SquiffyPlugin} from "../types.plugins.js";
import {rotate} from "../utils.js";
import Handlebars from "handlebars";

const rotateSequence = (squiffy: PluginHost, type: string, items: string[], options: any) => {
    const rotation = rotate(items.join(':').replace(/"/g, '&quot;').replace(/'/g, '&#39;'), null);
    const attribute = options.hash.set as string || '';
    if (attribute) {
        squiffy.set(attribute, rotation[0]);
    }
    return new Handlebars.SafeString(`<a class="squiffy-link" data-handler="${type}" data-options="${rotation[1]}" data-attribute="${attribute}" role="link">${rotation[0]}</a>`);
};

const handleLink = (squiffy: PluginHost, link: HTMLElement, isRotate: boolean) => {
    const result: HandleLinkResult = {};
    const options = link.getAttribute('data-options');

    const rotateResult = rotate(options, isRotate ? link.innerText : '');
    link.innerHTML = rotateResult[0]!.replace(/&quot;/g, '"').replace(/&#39;/g, '\'');

    link.setAttribute('data-options', rotateResult[1] || '');
    if (!rotateResult[1]) {
        result.disableLink = true;
    }
    const attribute = link.getAttribute('data-attribute');
    if (attribute) {
        squiffy.set(attribute, rotateResult[0]);
    }

    return result;
}

export const RotateSquencePlugin : SquiffyPlugin = {
    name: "rotateSequence",
    init(squiffy) {
        squiffy.registerHelper("rotate", (items: string[], options) =>
            rotateSequence(squiffy, "rotate", items, options));
        squiffy.registerHelper("sequence", (items: string[], options) =>
            rotateSequence(squiffy, "sequence", items, options));

        squiffy.registerLinkHandler("rotate", (link: HTMLElement) => {
            return handleLink(squiffy, link, true);
        });
        squiffy.registerLinkHandler("sequence", (link: HTMLElement) => {
            return handleLink(squiffy, link, false);
        });
    }
}
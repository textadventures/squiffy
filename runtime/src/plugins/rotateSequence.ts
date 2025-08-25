import {HandleLinkResult, PluginHost, SquiffyPlugin} from "../types.plugins.js";
import Handlebars from "handlebars";
import type { SafeString } from "handlebars";

export function RotateSequencePlugin() : SquiffyPlugin {
    const rotateSequence = (squiffy: PluginHost, type: string, items: (string | SafeString)[], options: any) => {
        const stringItems = items.map(i => i.toString());
        const rotation = rotate(stringItems, null);
        const attribute = options.hash.set as string || '';
        if (attribute) {
            squiffy.set(attribute, rotation[0]);
        }
        const optionsString = JSON.stringify(rotation.slice(1)) || '';
        return new Handlebars.SafeString(`<a class="squiffy-link" data-handler="${type}" data-options='${optionsString}' data-attribute="${attribute}" role="link">${rotation[0]}</a>`);
    };

    const handleLink = (squiffy: PluginHost, link: HTMLElement, isRotate: boolean) => {
        const result: HandleLinkResult = {};
        const options = JSON.parse(link.getAttribute('data-options')) as string[] || [];

        const rotateResult = rotate(options, isRotate ? link.innerText : '');
        link.innerHTML = rotateResult[0];

        link.setAttribute('data-options', JSON.stringify(rotateResult.slice(1)) || '');
        if (!rotateResult[1]) {
            result.disableLink = true;
        }
        const attribute = link.getAttribute('data-attribute');
        if (attribute) {
            squiffy.set(attribute, rotateResult[0]);
        }

        return result;
    }

    const rotate = (options: string[], current: string | null): string[] => {
        const next = options[0]
        let remaining = options.slice(1);
        if (current) remaining.push(current);
        return [next, ...remaining];
    }

    return {
        name: "rotateSequence",
        init(squiffy: PluginHost) {
            squiffy.registerHelper("rotate", (items: (string | SafeString)[], options) =>
                rotateSequence(squiffy, "rotate", items, options));
            squiffy.registerHelper("sequence", (items: (string | SafeString)[], options) =>
                rotateSequence(squiffy, "sequence", items, options));

            squiffy.registerLinkHandler("rotate", (link: HTMLElement) => {
                return handleLink(squiffy, link, true);
            });
            squiffy.registerLinkHandler("sequence", (link: HTMLElement) => {
                return handleLink(squiffy, link, false);
            });
        }
    }
}
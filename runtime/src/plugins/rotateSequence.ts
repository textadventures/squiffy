import { HandleLinkResult, PluginHost, SquiffyPlugin } from "../types.plugins.js";
import Handlebars from "handlebars";
import type { SafeString } from "handlebars";

export function RotateSequencePlugin() : SquiffyPlugin {
    const escapeHtml = (str: string) => {
        return str.replace(/&/g, "&amp;")
                  .replace(/'/g, "&#39;")
                  .replace(/"/g, "&quot;")
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;");
    };

    const rotateSequence = (squiffy: PluginHost, type: string, items: (string | SafeString)[], options: any) => {
        const stringItems = items.map(i => i.toString());
        const rotation = rotate(stringItems, null);
        const attribute = options.hash.set as string || "";
        if (attribute) {
            squiffy.set(attribute, rotation[0]);
        }
        const optionsString = escapeHtml(JSON.stringify(rotation.slice(1)) || "");
        const text = options.hash.show == "next" ? rotation[1] : rotation[0];
        return new Handlebars.SafeString(`<a class="squiffy-link" data-handler="${type}" data-value="${escapeHtml(rotation[0])}" data-show="${options.hash.show || ""}" data-options='${optionsString}' data-attribute="${attribute}" role="link">${text}</a>`);
    };

    const handleLink = (squiffy: PluginHost, link: HTMLElement, isRotate: boolean) => {
        const result: HandleLinkResult = {};
        const options = JSON.parse(link.getAttribute("data-options")) as string[] || [];

        const rotateResult = rotate(options, isRotate ? link.getAttribute("data-value") : "");

        link.innerHTML = link.getAttribute("data-show") == "next" ? rotateResult[1] : rotateResult[0];
        link.setAttribute("data-value", rotateResult[0]);
        link.setAttribute("data-options", JSON.stringify(rotateResult.slice(1)) || "");
        if (!rotateResult[1]) {
            result.disableLink = true;
        }
        const attribute = link.getAttribute("data-attribute");
        if (attribute) {
            squiffy.set(attribute, link.getAttribute("data-value"));
        }

        // Clear any text selection caused by rapid clicking
        window.getSelection()?.removeAllRanges();

        return result;
    };

    const rotate = (options: string[], current: string | null): string[] => {
        const next = options[0];
        const remaining = options.slice(1);
        if (current) remaining.push(current);
        return [next, ...remaining];
    };

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
    };
}
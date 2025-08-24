import {SquiffyPlugin} from "../types.plugins.js";
import Handlebars from "handlebars";

export const LivePlugin: SquiffyPlugin = {
    name: "live",
    init(squiffy) {
        squiffy.registerHelper("live", (attribute: string, options) => {
            let result = '';
            const section = options.hash.section as string || '';
            if (section) {
                result = squiffy.processText(squiffy.getSectionText(section) || '', true);
                return new Handlebars.SafeString(`<span class="squiffy-live" data-attribute="${attribute}" data-section="${section}">${result}</span>`);
            }
            const passage = options.hash.passage as string || '';
            if (passage) {
                result = squiffy.processText(squiffy.getPassageText(passage) || '', true);
                return new Handlebars.SafeString(`<span class="squiffy-live" data-attribute="${attribute}" data-passage="${passage}">${result}</span>`);
            }
            return new Handlebars.SafeString(`<span class="squiffy-live" data-attribute="${attribute}">${squiffy.get(attribute)}</span>`);
        });

        function processElement(el: HTMLElement) {
            // TODO: Update these elements when the attribute changes
            console.log("Found element:", el);
        }

        // Handle any already-existing elements
        squiffy.outputElement.querySelectorAll(".squiffy-live").forEach(processElement);

        // Watch for new ones
        new MutationObserver((mutations) => {
            for (const m of mutations) {
                m.addedNodes.forEach(node => {
                    if (node instanceof HTMLElement) {
                        // Check the added node itself
                        if (node.classList.contains("squiffy-live")) {
                            processElement(node);
                        }
                        // Check any children of the added node
                        node.querySelectorAll?.(".squiffy-live").forEach(processElement);
                    }
                });
            }
        }).observe(squiffy.outputElement, {childList: true, subtree: true});

        squiffy.on('set', e => {
            console.log(`Set...${e.attribute} = ${e.value}`);
        })
    }
}
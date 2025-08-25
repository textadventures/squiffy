import {PluginHost, SquiffyPlugin} from "../types.plugins.js";
import Handlebars from "handlebars";

export function LivePlugin(): SquiffyPlugin {
    let squiffy: PluginHost;
    return {
        name: "live",
        init(sq: PluginHost) {
            squiffy = sq;

            // No need to render the attribute value (or section or passage contents) here - this
            // is handled by onWrite, so that we pick up any attribute values set in the same passage.
            // TODO: We could mark values as "pending", then in onWrite we could iteratively resolve
            // any that are still pending. That would let us pick up {{live}} helpers inside embed
            // live sections/passages.
            squiffy.registerHelper("live", (attribute: string, options) => {
                const section = options.hash.section as string || '';
                if (section) {
                    return new Handlebars.SafeString(`<span class="squiffy-live" data-attribute="${attribute}" data-section="${section}"></span>`);
                }
                const passage = options.hash.passage as string || '';
                if (passage) {
                    return new Handlebars.SafeString(`<span class="squiffy-live" data-attribute="${attribute}" data-passage="${passage}"></span>`);
                }
                return new Handlebars.SafeString(`<span class="squiffy-live" data-attribute="${attribute}"></span>`);
            });

            squiffy.on('set', e => {
                const selector = `.squiffy-live[data-attribute="${CSS.escape(e.attribute)}"]`;
                squiffy.outputElement.querySelectorAll<HTMLElement>(selector).forEach((el) => {
                    if (el.dataset.section) {
                        const sectionText = squiffy.getSectionText(el.dataset.section);
                        if (sectionText) {
                            el.innerHTML = squiffy.processText(sectionText, true);
                        }
                    } else if (el.dataset.passage) {
                        const passageText = squiffy.getPassageText(el.dataset.passage);
                        if (passageText) {
                            el.innerHTML = squiffy.processText(passageText, true);
                        }
                    } else {
                        el.textContent = e.value;
                    }
                });
            })
        },
        onWrite(element: HTMLElement) {
            if (!squiffy) return;

            const selector = ".squiffy-live";
            element.querySelectorAll<HTMLElement>(selector).forEach((el) => {
                if (el.dataset.section) {
                    const sectionText = squiffy.getSectionText(el.dataset.section);
                    if (sectionText) {
                        el.innerHTML = squiffy.processText(sectionText, true);
                    }
                } else if (el.dataset.passage) {
                    const passageText = squiffy.getPassageText(el.dataset.passage);
                    if (passageText) {
                        el.innerHTML = squiffy.processText(passageText, true);
                    }
                } else {
                    const attribute = el.dataset.attribute;
                    el.textContent = attribute ? squiffy.get(attribute) : '';
                }
            });
        }
    };
}
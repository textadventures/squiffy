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

        squiffy.on('set', e => {
            const selector = `.squiffy-live[data-attribute="${CSS.escape(e.attribute)}"]`;
            document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
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
    }
}
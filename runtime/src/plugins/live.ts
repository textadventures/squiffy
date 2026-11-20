import { PluginHost, SquiffyPlugin } from "../types.plugins.js";
import Handlebars from "handlebars";
import { fadeReplace } from "../utils.js";
import { SquiffyEventMap } from "../events.js";
import { parsePath } from "../paths.js";

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
                const section = options.hash.section as string || "";
                if (section) {
                    return new Handlebars.SafeString(`<span class="squiffy-live" data-attribute="${attribute}" data-section="${section}"></span>`);
                }
                const passage = options.hash.passage as string || "";
                if (passage) {
                    return new Handlebars.SafeString(`<span class="squiffy-live" data-attribute="${attribute}" data-passage="${passage}"></span>`);
                }
                return new Handlebars.SafeString(`<span class="squiffy-live" data-attribute="${attribute}"></span>`);
            });

            const onSet = async (e: SquiffyEventMap["set"]) => {
                const promises: Promise<void>[] = [];
                // The "set" event names the attribute that changed, so {{live "hero.hp"}} is
                // updated when hero is set (#442)
                const elements = [...squiffy.outputElement.querySelectorAll<HTMLElement>(".squiffy-live[data-attribute]")]
                    .filter(el => parsePath(el.dataset.attribute!)[0] === e.attribute);
                for (const el of elements) {
                    const oldContent = el.innerHTML;
                    let newContent = "";
                    if (el.dataset.section) {
                        const sectionText = squiffy.getSectionText(el.dataset.section);
                        if (sectionText) {
                            newContent = squiffy.processText(sectionText, true);
                        }
                    } else if (el.dataset.passage) {
                        const passageText = squiffy.getPassageText(el.dataset.passage);
                        if (passageText) {
                            newContent = squiffy.processText(passageText, true);
                        }
                    } else {
                        newContent = el.dataset.attribute == e.attribute ? e.value : squiffy.get(el.dataset.attribute!);
                    }
                    // A value that's a number is the same as the text on screen, e.g. when another
                    // part of the same attribute changes, such as another setting
                    if (oldContent !== String(newContent)) {
                        promises.push(fadeReplace(el, newContent));
                    }
                }
                await Promise.all(promises);
            };

            squiffy.on("set", async (e) => {
                await onSet(e);
            });
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
                    el.textContent = attribute ? squiffy.get(attribute) : "";
                }
            });
        }
    };
}
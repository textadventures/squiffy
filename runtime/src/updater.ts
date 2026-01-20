import { Story } from "./types.js";

function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    return a.every((val, idx) => val === b[idx]);
}

export function updateStory(oldStory: Story,
                            newStory: Story,
                            outputElement: HTMLElement,
                            ui: any,
                            disableLink: (link: Element) => void,
                            processAttributes: (attributes: string[]) => void) {

    function safeQuerySelector(name: string) {
        return name.replace(/'/g, "\\'");
    }

    function getSectionContent(section: string) {
        return outputElement.querySelectorAll(`[data-source='[[${safeQuerySelector(section)}]]']`);
    }

    function getPassageContent(section: string, passage: string) {
        return outputElement.querySelectorAll(`[data-source='[[${safeQuerySelector(section)}]][${safeQuerySelector(passage)}]']`);
    }

    function updateElementTextPreservingDisabledPassageLinks(element: Element, text: string) {
        // Record which passage links are disabled
        const disabledPassages = Array.from(element
            .querySelectorAll("a.link-passage.disabled"))
            .map((el: HTMLElement) => el.getAttribute("data-passage"));

        element.innerHTML = text;

        // Re-disable links that were disabled before the update
        for (const passage of disabledPassages) {
            const link = element.querySelector(`a.link-passage[data-passage="${passage}"]`);
            if (link) disableLink(link);
        }
    }

    for (const existingSection of Object.keys(oldStory.sections)) {
        const elements = getSectionContent(existingSection);
        if (elements.length) {
            const newSection = newStory.sections[existingSection];
            if (!newSection) {
                // section has been deleted
                for (const element of elements) {
                    const parentOutputSection = element.closest(".squiffy-output-section");
                    parentOutputSection.remove();
                }
            }
            else {
                const oldSection = oldStory.sections[existingSection];
                const attributesChanged = !arraysEqual(oldSection.attributes, newSection.attributes);
                const textChanged = newSection.text != oldSection.text;

                if (attributesChanged) {
                    // Re-process the new attributes to update state
                    processAttributes(newSection.attributes || []);
                }

                if (textChanged || attributesChanged) {
                    // Re-render text (attributes may affect text output via helpers)
                    for (const element of elements) {
                        updateElementTextPreservingDisabledPassageLinks(element, ui.processText(newSection.text, false));
                    }
                }
            }
        }

        if (!oldStory.sections[existingSection].passages) continue;

        for (const existingPassage of Object.keys(oldStory.sections[existingSection].passages)) {
            const elements = getPassageContent(existingSection, existingPassage);
            if (!elements.length) continue;

            const newPassage = newStory.sections[existingSection]?.passages && newStory.sections[existingSection]?.passages[existingPassage];
            if (!newPassage) {
                // passage has been deleted
                for (const element of elements) {
                    const parentOutputPassage = element.closest(".squiffy-output-passage");
                    parentOutputPassage.remove();
                }
            }
            else {
                const oldPassage = oldStory.sections[existingSection].passages[existingPassage];
                const attributesChanged = !arraysEqual(oldPassage.attributes, newPassage.attributes);
                const textChanged = newPassage.text != oldPassage.text;

                if (attributesChanged) {
                    // Re-process the new attributes to update state
                    processAttributes(newPassage.attributes || []);
                }

                if (textChanged || attributesChanged) {
                    // Re-render text (attributes may affect text output via helpers)
                    for (const element of elements) {
                        updateElementTextPreservingDisabledPassageLinks(element, ui.processText(newPassage.text, false));
                    }
                }
            }
        }
    }
}
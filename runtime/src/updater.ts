import {Story} from "./types.js";

export function updateStory(oldStory: Story,
                            newStory: Story,
                            outputElement: HTMLElement,
                            ui: any,
                            disableLink: (link: Element) => void) {

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
            else if (newSection.text != oldStory.sections[existingSection].text) {
                // section has been updated
                for (const element of elements) {
                    updateElementTextPreservingDisabledPassageLinks(element, ui.processText(newSection.text, false));
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
            else if (newPassage.text && newPassage.text != oldStory.sections[existingSection].passages[existingPassage].text) {
                // passage has been updated
                for (const element of elements) {
                    updateElementTextPreservingDisabledPassageLinks(element, ui.processText(newPassage.text, false));
                }
            }
        }
    }
}
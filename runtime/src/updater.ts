import { Section, Story } from "./types.js";

function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    return a.every((val, idx) => val === b[idx]);
}

export function updateStory(oldStory: Story,
                            newStory: Story,
                            outputElement: HTMLElement,
                            processText: (text: string, section: Section) => string,
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

    // Links to the same passage are matched up in order, so that in an {{#each}}, the item's link
    // that was clicked is the one that stays disabled (#448)
    function passageLinksByName(element: Element) {
        const byName = new Map<string, Element[]>();
        for (const link of element.querySelectorAll("a.link-passage[data-passage]")) {
            const name = link.getAttribute("data-passage")!;
            if (!byName.has(name)) byName.set(name, []);
            byName.get(name)!.push(link);
        }
        return byName;
    }

    function updateElementTextPreservingDisabledPassageLinks(element: Element, text: string) {
        const oldLinks = passageLinksByName(element);

        element.innerHTML = text;

        // Re-disable links that were disabled before the update, keeping which click or
        // {{deactivate}} disabled them, so going back enables the right ones
        const newLinks = passageLinksByName(element);
        for (const [name, links] of oldLinks) {
            links.forEach((oldLink, i) => {
                const link = newLinks.get(name)?.[i];
                if (!link || !oldLink.classList.contains("disabled")) return;
                disableLink(link);
                for (const attr of ["data-clicked", "data-deactivated-by"]) {
                    const value = oldLink.getAttribute(attr);
                    if (value !== null) link.setAttribute(attr, value);
                }
            });
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
                    parentOutputSection?.remove();
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
                        updateElementTextPreservingDisabledPassageLinks(element, processText(newSection.text || "", newSection));
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
                    parentOutputPassage?.remove();
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
                        updateElementTextPreservingDisabledPassageLinks(element, processText(newPassage.text || "", newStory.sections[existingSection]));
                    }
                }
            }
        }
    }
}
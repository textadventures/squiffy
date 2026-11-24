// Keeps the story's links usable from the keyboard and with a screen reader. A link that can be
// clicked can be reached with Tab. One that can't (it was clicked already, or it's in a section the
// player has left) is taken out of the Tab order and marked aria-disabled, so a screen reader
// doesn't offer it as a link that does nothing.

const LINK = "a.squiffy-link";

export function setLinkActive(link: Element, active: boolean) {
    if (active) {
        // A link waiting for the section's text boxes to be filled in stays disabled for a screen
        // reader (see inputValidation.ts), but can still be reached
        if (!link.classList.contains("validation-disabled")) link.removeAttribute("aria-disabled");
        link.setAttribute("tabindex", "0");
    }
    else {
        link.setAttribute("aria-disabled", "true");
        link.setAttribute("tabindex", "-1");
    }
}

// Whether a link can be clicked: it isn't disabled, and it's in the section being shown
export function isLinkActive(link: Element, currentSection: Element | null) {
    return !link.classList.contains("disabled")
        && !!currentSection
        && link.closest(".squiffy-output-section") === currentSection;
}

// Brings every link in the output up to date, after the section being shown has changed: when a
// new one is shown, the player goes back, or a saved game is loaded
export function syncLinkStates(output: Element, currentSection: Element | null) {
    for (const link of output.querySelectorAll(LINK)) {
        setLinkActive(link, isLinkActive(link, currentSection));
    }
}

// Moves the keyboard focus to the text just shown, after the player clicked a link or the story
// went on by itself, so a screen reader reads it next, and Tab goes on to its links. Otherwise the
// focus would be left on the link that was clicked, which can't be clicked again and is taken out
// of the Tab order. Only if the focus is in the story already, or nowhere, so it doesn't jump away
// from a header button, a dialog, or a page the story is embedded in.
export function focusNewText(element: HTMLElement | null, story: Element) {
    if (!element || !element.isConnected) return;
    const active = element.ownerDocument.activeElement;
    if (active && active !== element.ownerDocument.body && !story.contains(active)) return;
    if (!element.hasAttribute("tabindex")) {
        element.setAttribute("tabindex", "-1");
        // Only while it has the focus, so it isn't saved with the story's text
        element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
    }
    element.focus({ preventScroll: true });
}

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

// Whether the keyboard focus is in the story, or nowhere (on the page's body)
export function focusIsIn(story: Element) {
    const active = story.ownerDocument.activeElement;
    return !active || active === story.ownerDocument.body || story.contains(active);
}

// Gives an element the focus with a tabindex it only has while it has the focus, so it isn't saved
// with the story's text
function focusTemporarily(element: HTMLElement) {
    if (!element.hasAttribute("tabindex")) {
        element.setAttribute("tabindex", "-1");
        element.classList.add("squiffy-focus-target");
        element.addEventListener("blur", () => {
            element.removeAttribute("tabindex");
            element.classList.remove("squiffy-focus-target");
            if (!element.classList.length) element.removeAttribute("class");
        }, { once: true });
    }
    element.focus({ preventScroll: true });
}

// When the screen is cleared and the text that has the focus (the link just clicked) is about to be
// hidden, the story itself takes the focus until the new text is shown. Otherwise the focus is lost
// as soon as the text is moved, and a screen reader such as VoiceOver moves it somewhere else, such
// as a header button.
export function holdFocus(story: HTMLElement, hiding: Element[]) {
    const active = story.ownerDocument.activeElement;
    if (active && hiding.some(e => e.contains(active))) focusTemporarily(story);
}

// Moves the keyboard focus to the text just shown, after the player clicked a link or the story
// went on by itself, so a screen reader reads it next, and Tab goes on to its links. Otherwise the
// focus would be left on the link that was clicked, which can't be clicked again and is taken out
// of the Tab order.
// clicked: the focus was in the story when the player clicked the link that showed it, so it goes
// to the new text wherever it is now (it may have been moved while the old text was cleared away),
// unless a dialog has been opened since. Otherwise, only if the focus is in the story or nowhere,
// so a {{goto after=}} doesn't take it from a header button, a dialog, or a page the story is
// embedded in.
export function focusNewText(element: HTMLElement | null, story: Element, clicked = false) {
    if (!element || !element.isConnected) return;
    const active = element.ownerDocument.activeElement;
    if (clicked ? active?.closest("dialog[open]") : !focusIsIn(story)) return;
    focusTemporarily(element);
}

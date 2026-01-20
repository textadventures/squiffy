/**
 * Input validation for Squiffy stories.
 *
 * Handles HTML5 form validation constraints (required, minlength, pattern, etc.)
 * and disables section/passage links until all inputs in the current section are valid.
 */

const INPUT_SELECTOR = "input:not([disabled]), textarea:not([disabled]), select:not([disabled])";
const LINK_SELECTOR = "a.squiffy-link[data-section], a.squiffy-link[data-passage]";

/**
 * Check if all inputs in the given element are valid according to HTML5 validation constraints.
 */
export function areInputsValid(sectionElement: HTMLElement | null): boolean {
    if (!sectionElement) return true;

    const inputs = sectionElement.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        INPUT_SELECTOR
    );

    for (const input of inputs) {
        if (!input.checkValidity()) {
            return false;
        }
    }

    return true;
}

/**
 * Update the enabled/disabled state of all section and passage links
 * based on whether all inputs are currently valid.
 */
export function updateLinkStates(sectionElement: HTMLElement | null): void {
    if (!sectionElement) return;

    const isValid = areInputsValid(sectionElement);
    const links = sectionElement.querySelectorAll<HTMLElement>(LINK_SELECTOR);

    for (const link of links) {
        if (isValid) {
            link.classList.remove("validation-disabled");
            link.removeAttribute("aria-disabled");
        } else {
            link.classList.add("validation-disabled");
            link.setAttribute("aria-disabled", "true");
        }
    }
}

/**
 * Set up input validation listeners on all inputs in the given section element.
 * This should be called whenever new content is added to the section.
 */
export function setupInputValidation(sectionElement: HTMLElement | null): void {
    if (!sectionElement) return;

    const inputs = sectionElement.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        INPUT_SELECTOR
    );

    for (const input of inputs) {
        // Listen for input changes to update link states
        input.addEventListener("input", () => updateLinkStates(sectionElement));
        input.addEventListener("change", () => updateLinkStates(sectionElement));

        // Mark invalid inputs with visual feedback
        input.addEventListener("invalid", (e) => {
            e.preventDefault(); // Prevent default browser validation UI
            input.classList.add("squiffy-invalid");
        });

        // Remove invalid class when input becomes valid
        input.addEventListener("input", () => {
            if (input.checkValidity()) {
                input.classList.remove("squiffy-invalid");
            }
        });
    }

    // Initial state update
    updateLinkStates(sectionElement);
}

// {{#replace}}: fades the label's text out, replaces it, and fades it in. The section's links wait
// for it, so it always finishes: see transitionEnd.
export async function fadeReplace(element: HTMLElement, text: string): Promise<void> {
    const fadedOut = transitionEnd(element);
    element.classList.add("fade-out");
    await fadedOut;

    element.innerHTML = text;
    const fadedIn = transitionEnd(element);
    element.classList.remove("fade-out");
    element.classList.add("fade-in");
    await fadedIn;
    element.classList.remove("fade-in");
}

// When the element's own transition ends. Not one inside it, whose transitionend bubbles up to it,
// such as the colour of a link that's just been clicked. And not more than a moment longer than
// the fades take (200ms), in case it doesn't run at all, e.g. if the element isn't shown, or its
// classes change back within a frame.
function transitionEnd(element: HTMLElement, timeout = 1000): Promise<void> {
    return new Promise(resolve => {
        const done = () => {
            element.removeEventListener("transitionend", ended);
            element.removeEventListener("transitioncancel", ended);
            clearTimeout(timer);
            resolve();
        };
        const ended = (event: Event) => {
            if (event.target === element) done();
        };
        element.addEventListener("transitionend", ended);
        element.addEventListener("transitioncancel", ended);
        const timer = setTimeout(done, timeout);
    });
}

// A delay in milliseconds (#451): a number, or text with a number of seconds or milliseconds in
// it, as in CSS and Twine, e.g. "3s", "1.5s" or "500ms" ("500" is milliseconds too). Returns null
// if it isn't one, or is negative.
export function parseDelay(value: unknown): number | null {
    if (typeof value == "number") return Number.isFinite(value) && value >= 0 ? value : null;
    if (typeof value != "string") return null;
    const match = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(ms|s)?\s*$/i.exec(value);
    if (!match) return null;
    const n = Number(match[1]);
    return match[2]?.toLowerCase() == "s" ? n * 1000 : n;
}

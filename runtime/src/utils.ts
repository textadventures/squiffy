export function fadeReplace(element: HTMLElement, text: string): Promise<void> {
    return new Promise((resolve) => {
        element.addEventListener("transitionend", function () {
            element.innerHTML = text;

            element.addEventListener("transitionend", function () {
                element.classList.remove("fade-in");
                resolve();
            }, { once: true });

            element.classList.remove("fade-out");
            element.classList.add("fade-in");
        }, { once: true });

        element.classList.add("fade-out");
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

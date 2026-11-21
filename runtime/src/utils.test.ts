import { afterEach, beforeEach, expect, test, vi } from "vitest";
import globalJsdom from "global-jsdom";
import { fadeReplace } from "./utils.js";

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body></body></html>");
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    cleanup();
});

const label = () => {
    const element = document.createElement("span");
    element.innerHTML = "Old, with <a class=\"squiffy-link\">a link</a>";
    document.body.appendChild(element);
    return element;
};

const transitionEnd = (target: Element) => target.dispatchEvent(new window.Event("transitionend", { bubbles: true }));

test("fadeReplace fades the text out, replaces it, and fades it in", async () => {
    const element = label();
    let done = false;
    void fadeReplace(element, "New").then(() => { done = true; });
    expect(element.classList.contains("fade-out")).toBe(true);

    transitionEnd(element);
    await vi.advanceTimersByTimeAsync(0);
    expect(element.innerHTML).toBe("New");
    expect(element.classList.contains("fade-in")).toBe(true);

    transitionEnd(element);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(element.className).toBe("");
});

test("fadeReplace isn't fooled by a transition ending inside the text, such as a link's colour", async () => {
    const element = label();
    void fadeReplace(element, "New");

    transitionEnd(element.querySelector("a")!);
    await vi.advanceTimersByTimeAsync(0);
    expect(element.innerHTML).toContain("Old");
});

test("fadeReplace finishes even if the fades never run, so the section's links come back", async () => {
    const element = label();
    let done = false;
    void fadeReplace(element, "New").then(() => { done = true; });

    await vi.advanceTimersByTimeAsync(5000);
    expect(element.innerHTML).toBe("New");
    expect(done).toBe(true);
});

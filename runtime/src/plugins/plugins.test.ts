import { expect, test, beforeEach, afterEach, vi } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "../squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";

// anime.js captures the global document when it's imported, which is before each test
// sets up jsdom, so it can't run here. Replace it with a stub that completes immediately.
vi.mock("animejs", () => ({
    animate: (_targets: unknown, params: { onComplete?: () => void }) => {
        setTimeout(() => params.onComplete?.());
    },
    stagger: () => 0,
    text: {
        split: (el: HTMLElement) => ({ chars: [el], words: [el], lines: [el] }),
    },
}));

const html = `
<!DOCTYPE html>
<html>
<head>
</head>
<body>
    <div id="squiffy">
    </div>
</body>
</html>
`;

// Mock ResizeObserver for jsdom
class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}
global.ResizeObserver = ResizeObserverMock as any;

const compile = async (script: string) => {
    const compileResult = await squiffyCompile({
        script: script,
    });

    if (!compileResult.success) {
        throw new Error("Compile failed");
    }

    const story = compileResult.output.story;
    const js = compileResult.output.js.map(jsLines => new Function("squiffy", "get", "set", jsLines.join("\n")));

    return {
        story: {
            js: js as any,
            ...story,
        },
    };
};

const initScript = async (script: string) => {
    const element = document.getElementById("squiffy");

    if (!element) {
        throw new Error("Element not found");
    }

    const compileResult = await compile(script);

    const squiffyApi = await init({
        element: element,
        story: compileResult.story,
    });

    await squiffyApi.begin();

    return {
        squiffyApi,
        element
    };
};

const findLink = (element: HTMLElement, linkType: string, linkText: string) => {
    const links = element.querySelectorAll(`a.squiffy-link[data-handler="${linkType}"]`);
    return Array.from(links).find(link => link.textContent === linkText) as HTMLElement | undefined;
};

// jsdom doesn't run CSS transitions, so fadeReplace would wait forever for a
// "transitionend" event. Fire one whenever a fade class is added instead.
const completeFadeTransitions = () => {
    const TransitionEvent = window.Event;
    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            const el = mutation.target as HTMLElement;
            const oldClasses = (mutation.oldValue || "").split(" ");
            for (const fadeClass of ["fade-out", "fade-in"]) {
                if (el.classList.contains(fadeClass) && !oldClasses.includes(fadeClass)) {
                    setTimeout(() => el.dispatchEvent(new TransitionEvent("transitionend")));
                }
            }
        }
    });
    observer.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
        attributeOldValue: true,
    });
    return () => observer.disconnect();
};

const findPassageLink = (element: HTMLElement, passageName: string) =>
    element.querySelector<HTMLElement>(`a.squiffy-link[data-passage="${passageName}"]`) ?? undefined;

let cleanup: { (): void };
let stopCompletingTransitions: { (): void };

beforeEach(() => {
    cleanup = globalJsdom(html);
    stopCompletingTransitions = completeFadeTransitions();
    // Mock document.fonts for animations
    Object.defineProperty(document, "fonts", {
        value: { status: "loaded" },
        writable: true,
        configurable: true
    });
});

afterEach(() => {
    stopCompletingTransitions();
    localStorage.clear();
    cleanup();
});

// ===== RandomPlugin Tests =====

test("Random plugin: select from list", async () => {
    const script = `
You got a {{random (array "apple" "banana" "orange")}}.
`;

    const { element } = await initScript(script);
    const text = element.textContent || "";

    // Should contain one of the options
    expect(text).toMatch(/You got a (apple|banana|orange)\./);
});

test("Random plugin: set attribute", async () => {
    const script = `
@set fruit = initial

{{random (array "apple" "banana" "orange") set="fruit"}}
`;

    const { squiffyApi } = await initScript(script);
    const fruit = squiffyApi.get("fruit");

    // The attribute should be set to one of the random values
    expect(["apple", "banana", "orange"]).toContain(fruit);
});

test("Random plugin: use as subexpression with set helper", async () => {
    const script = `
{{set "fruit" (random (array "apple" "banana" "orange"))}}

Fruit is: {{fruit}}

{{#if (eq fruit "apple")}}It's an apple!{{/if}}
{{#if (eq fruit "banana")}}It's a banana!{{/if}}
{{#if (eq fruit "orange")}}It's an orange!{{/if}}
`;

    const { squiffyApi, element } = await initScript(script);
    const fruit = squiffyApi.get("fruit");
    const text = element.textContent || "";

    // The attribute should be set to one of the random values (as a string, not an object)
    expect(["apple", "banana", "orange"]).toContain(fruit);
    expect(typeof fruit).toBe("string");

    // The output should show the fruit value, not [object Object]
    expect(text).toMatch(/Fruit is: (apple|banana|orange)/);
    expect(text).not.toContain("[object Object]");

    // One of the conditionals should have matched
    expect(text).toMatch(/It's an? (apple|banana|orange)!/);
});

// ===== ReplaceLabel Tests =====

test("Label plugin: create labeled span", async () => {
    const script = `
Your score is {{#label "score"}}0{{/label}}.
`;

    const { element } = await initScript(script);

    const labelSpan = element.querySelector(".squiffy-label-score");
    expect(labelSpan).not.toBeNull();
    expect(labelSpan?.textContent).toBe("0");
});

test("Replace plugin: replace labeled content", async () => {
    const script = `
Your score is {{#label "score"}}0{{/label}}.

[Increase score]

[Increase score]:
{{#replace "score"}}**10**{{/replace}}
`;

    const { squiffyApi, element } = await initScript(script);

    const link = findPassageLink(element, "Increase score");
    await squiffyApi.clickLink(link!);

    const labelSpans = element.querySelectorAll(".squiffy-label-score");
    expect(labelSpans.length).toBe(1);
    expect(labelSpans[0].innerHTML).toBe("<strong>10</strong>");
    expect(labelSpans[0].classList.contains("fade-out")).toBe(false);
    expect(labelSpans[0].classList.contains("fade-in")).toBe(false);
});

// ===== RotateSequencePlugin Tests =====

test("Sequence plugin: click through sequence", async () => {
    const script = `
Click: {{sequence (array "first" "second" "third")}}
`;

    const { squiffyApi, element } = await initScript(script);

    let link = findLink(element, "sequence", "first");
    expect(link).not.toBeUndefined();

    // Click first time
    await squiffyApi.clickLink(link!);
    link = findLink(element, "sequence", "second");
    expect(link).not.toBeUndefined();

    // Click second time
    await squiffyApi.clickLink(link!);
    link = findLink(element, "sequence", "third");
    expect(link).not.toBeUndefined();

    // Click third time - should be disabled now
    await squiffyApi.clickLink(link!);
    link = findLink(element, "sequence", "third");
    // Link still exists but should be disabled
    expect(link?.classList.contains("disabled")).toBe(true);
});

test("Sequence plugin: show next option", async () => {
    const script = `
Click: {{sequence (array "first" "second" "third") show="next"}}
`;

    const { element } = await initScript(script);

    // When show="next", it should display the next option, not the current
    const link = findLink(element, "sequence", "second");
    expect(link).not.toBeUndefined();
});

test("Sequence plugin: set attribute", async () => {
    const script = `
{{sequence (array "apple" "banana" "orange") set="fruit"}}

You selected {fruit}.
`;

    const { squiffyApi, element } = await initScript(script);

    expect(squiffyApi.get("fruit")).toBe("apple");

    const link = findLink(element, "sequence", "apple");
    await squiffyApi.clickLink(link!);

    expect(squiffyApi.get("fruit")).toBe("banana");
});

test("Rotate plugin: cycles through values", async () => {
    const script = `
Click: {{rotate (array "first" "second" "third")}}
`;

    const { squiffyApi, element } = await initScript(script);

    let link = findLink(element, "rotate", "first");
    expect(link).not.toBeUndefined();

    // Click first time - should go to second
    await squiffyApi.clickLink(link!);
    link = findLink(element, "rotate", "second");
    expect(link).not.toBeUndefined();

    // Click second time - should go to third
    await squiffyApi.clickLink(link!);
    link = findLink(element, "rotate", "third");
    expect(link).not.toBeUndefined();

    // Click third time - should cycle back to first
    await squiffyApi.clickLink(link!);
    link = findLink(element, "rotate", "first");
    expect(link).not.toBeUndefined();
});

// ===== LivePlugin Tests =====

test("Live plugin: creates live span", async () => {
    const script = `
@set score = 0

Score: {{live "score"}}.
`;

    const { element } = await initScript(script);

    const liveSpan = element.querySelector(".squiffy-live");
    expect(liveSpan).not.toBeNull();
    expect(liveSpan?.getAttribute("data-attribute")).toBe("score");
    expect(liveSpan?.textContent).toBe("0");
});

test("Live plugin: updates when attribute changes", async () => {
    const script = `
@set score = 0

Score: {{live "score"}}.

[Increase score]

[Increase score]:
@set score = 10
`;

    const { squiffyApi, element } = await initScript(script);

    const link = findPassageLink(element, "Increase score");
    await squiffyApi.clickLink(link!);

    // Live updates run in the background after the attribute is set, so wait for the fade to finish
    const liveSpan = element.querySelector(".squiffy-live");
    await vi.waitFor(() => {
        expect(liveSpan?.textContent).toBe("10");
        expect(liveSpan?.classList.contains("fade-in")).toBe(false);
    });
});

test("Live plugin: embed section content", async () => {
    const script = `
[[start]]:
@set mood = happy

Status: {{live "mood" section="status"}}

[Cheer up]

[Cheer up]:
@set mood = ecstatic

[[status]]:
You are {{mood}}.
`;

    const { squiffyApi, element } = await initScript(script);

    const liveSpan = element.querySelector(".squiffy-live");
    expect(liveSpan?.getAttribute("data-section")).toBe("status");
    expect(liveSpan?.textContent).toBe("You are happy.");

    const link = findPassageLink(element, "Cheer up");
    await squiffyApi.clickLink(link!);

    await vi.waitFor(() => expect(liveSpan?.textContent).toBe("You are ecstatic."));
});

test("Live plugin: embed passage content", async () => {
    const script = `
@set mood = happy

Status: {{live "mood" passage="status"}}

[Cheer up]

[Cheer up]:
@set mood = ecstatic

[status]:
You are {{mood}}.
`;

    const { squiffyApi, element } = await initScript(script);

    const liveSpan = element.querySelector(".squiffy-live");
    expect(liveSpan?.getAttribute("data-passage")).toBe("status");
    expect(liveSpan?.textContent).toBe("You are happy.");

    const link = findPassageLink(element, "Cheer up");
    await squiffyApi.clickLink(link!);

    await vi.waitFor(() => expect(liveSpan?.textContent).toBe("You are ecstatic."));
});

// ===== AnimatePlugin Tests =====

test("Animate plugin: creates animated span", async () => {
    const script = `
{{#animate "typewriter"}}Hello **world**{{/animate}}
`;

    const { element } = await initScript(script);

    // Once the animation completes, the original content is restored
    const animateSpan = element.querySelector("span[data-name]");
    expect(animateSpan).not.toBeNull();
    expect(animateSpan?.innerHTML).toBe("Hello <strong>world</strong>");
    expect(animateSpan?.classList.contains("squiffy-animate")).toBe(false);
});

test("Animate plugin: sets data attributes", async () => {
    const script = `
{{#animate "typewriter" trigger="link" interval=50}}[Click me]{{/animate}}

[Click me]:
You clicked!
`;

    const { element } = await initScript(script);

    const animateSpan = element.querySelector<HTMLElement>(".squiffy-animate");
    expect(animateSpan).not.toBeNull();
    expect(animateSpan?.tagName).toBe("SPAN");
    expect(animateSpan?.getAttribute("data-name")).toBe('"typewriter"');
    expect(JSON.parse(animateSpan!.getAttribute("data-content")!)).toContain('data-passage="Click me"');
    expect(animateSpan?.getAttribute("data-trigger")).toBe('"link"');
    expect(animateSpan?.getAttribute("data-interval")).toBe("50");
});

test("Animate plugin: trigger on link", async () => {
    const script = `
{{#animate "typewriter" trigger="link"}}[Click me]{{/animate}}

[Click me]:
You clicked!
`;

    const { element } = await initScript(script);

    const animateSpan = element.querySelector(".squiffy-animate");
    expect(animateSpan).not.toBeNull();
    expect(animateSpan?.getAttribute("data-trigger")).toBe('"link"');

    // Check that the link is inside the animated span
    const link = animateSpan?.querySelector("a");
    expect(link).not.toBeNull();
});

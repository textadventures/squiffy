import { expect, test, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler"; 

const html = `
<!DOCTYPE html>
<html>
<head>
</head>
<body>
    <div id="squiffy">
    </div>
    <div id="test">
    </div>
</body>
</html>
`;

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

const findLink = (element: HTMLElement, linkType: string, linkText: string, onlyEnabled: boolean = false) => {
    const links = onlyEnabled
        ? element.querySelectorAll(`.squiffy-output-section:last-child a.squiffy-link.link-${linkType}`)
        : element.querySelectorAll(`a.squiffy-link.link-${linkType}`);
    return Array.from(links).find(link => link.textContent === linkText && (onlyEnabled ? !link.classList.contains("disabled") : true)) as HTMLElement;
};

const getTestOutput = () => {
    const testElement = document.getElementById("test");
    if (!testElement) {
        throw new Error("Test element not found");
    }
    return testElement.innerText;
};

let cleanup: { (): void };

beforeEach(() => {
    cleanup = globalJsdom(html);
});

afterEach(() => {
    cleanup();
});

test('"Hello world" script should run', async () => {
    const { element } = await initScript("Hello world");
    expect(element.innerHTML).toMatchSnapshot();
});

test("Click a section link", async () => {
    const script = await fs.readFile("../examples/test/example.squiffy", "utf-8");
    const { squiffyApi, element } = await initScript(script);
    expect(element.innerHTML).toMatchSnapshot();

    expect(element.querySelectorAll("a.squiffy-link").length).toBe(10);
    const linkToPassage = findLink(element, "passage", "a link to a passage");
    const section3Link = findLink(element, "section", "section 3");

    expect(linkToPassage).not.toBeNull();
    expect(section3Link).not.toBeNull();
    expect(linkToPassage.classList).not.toContain("disabled");

    const handler = vi.fn();
    const off = squiffyApi.on("linkClick", handler);

    const handled = await squiffyApi.clickLink(section3Link);
    expect(handled).toBe(true);

    expect(element.innerHTML).toMatchSnapshot();

    // passage link is from the previous section, so should be unclickable
    expect(await squiffyApi.clickLink(linkToPassage)).toBe(false);

    // await for the event to be processed
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ linkType: "section" })
    );
    off();
});

test("Click a section link and go back", async () => {
    const script = await fs.readFile("../examples/test/example.squiffy", "utf-8");
    const { squiffyApi, element } = await initScript(script);

    const linkToPassage = findLink(element, "passage", "a link to a passage");
    const section3Link = findLink(element, "section", "section 3");
    expect(section3Link).not.toBeNull();

    await squiffyApi.clickLink(section3Link);

    // passage link is from the previous section, so should be unclickable
    expect(await squiffyApi.clickLink(linkToPassage)).toBe(false);

    // now go back
    squiffyApi.goBack();

    expect(element.innerHTML).toMatchSnapshot();

    // passage link should be clickable now
    expect(await squiffyApi.clickLink(linkToPassage)).toBe(true);
});

test("Click a passage link", async () => {
    const script = await fs.readFile("../examples/test/example.squiffy", "utf-8");
    const { squiffyApi, element } = await initScript(script);
    expect(element.innerHTML).toMatchSnapshot();

    expect(element.querySelectorAll("a.squiffy-link").length).toBe(10);
    const linkToPassage = findLink(element, "passage", "a link to a passage");
    const section3Link = findLink(element, "section", "section 3");

    expect(linkToPassage).not.toBeNull();
    expect(section3Link).not.toBeNull();
    expect(linkToPassage.classList).not.toContain("disabled");

    const handler = vi.fn();
    const off = squiffyApi.on("linkClick", handler);

    const handled = await squiffyApi.clickLink(linkToPassage);
    expect(handled).toBe(true);

    expect(linkToPassage.classList).toContain("disabled");
    expect(element.innerHTML).toMatchSnapshot();

    // shouldn't be able to click it again
    expect(await squiffyApi.clickLink(linkToPassage)).toBe(false);

    // await for the event to be processed
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ linkType: "passage" })
    );
    off();
});

test("Click a passage link and go back", async () => {
    const script = await fs.readFile("../examples/test/example.squiffy", "utf-8");
    const { squiffyApi, element } = await initScript(script);

    const linkToPassage = findLink(element, "passage", "a link to a passage");

    await squiffyApi.clickLink(linkToPassage);

    // the passage link was clicked, so should be disabled
    expect(linkToPassage.classList).toContain("disabled");

    // now go back
    squiffyApi.goBack();

    expect(element.innerHTML).toMatchSnapshot();

    // passage link should be clickable now
    expect(await squiffyApi.clickLink(linkToPassage)).toBe(true);
});

test("Run JavaScript functions", async () => {
    const script = `
    document.getElementById('test').innerText = 'Initial JavaScript';
@set some_string = some_value
@set some_number = 5

+++Continue...
    document.getElementById('test').innerText = "Value: " + get("some_number");
+++Continue...
    document.getElementById('test').innerText = "Value: " + get("some_string");
    set("some_number", 10);
+++Continue...
    document.getElementById('test').innerText = "Value: " + get("some_number");
+++Continue...
@inc some_number
+++Continue...
    document.getElementById('test').innerText = "Value: " + get("some_number");
+++Continue...
    squiffy.story.go("other section");
[[other section]]:
    document.getElementById('test').innerText = "In other section";
`;

    const clickContinue = async () => {
        const continueLink = findLink(element, "section", "Continue...", true);
        expect(continueLink).not.toBeNull();
        expect(continueLink).not.toBeUndefined();
        const handled = await squiffyApi.clickLink(continueLink);
        expect(handled).toBe(true);
    };

    const { squiffyApi, element } = await initScript(script);

    expect(getTestOutput()).toBe("Initial JavaScript");
    await clickContinue();
    
    expect(getTestOutput()).toBe("Value: 5");
    await clickContinue();

    expect(getTestOutput()).toBe("Value: some_value");
    await clickContinue();

    expect(getTestOutput()).toBe("Value: 10");

    await clickContinue();
    await clickContinue();
    expect(getTestOutput()).toBe("Value: 11");

    await clickContinue();
    expect(getTestOutput()).toBe("In other section");
});

function safeQuerySelector(name: string) {
    return name.replace(/'/g, "\\'");
}

function getSectionContent(element: HTMLElement, section: string) {
    return element.querySelector(`[data-source='[[${safeQuerySelector(section)}]]']`)?.textContent || null;
}

function getPassageContent(element: HTMLElement, section: string, passage: string) {
    return element.querySelector(`[data-source='[[${safeQuerySelector(section)}]][${safeQuerySelector(passage)}]']`)?.textContent || null;
}

test("Update default section output", async () => {
    const { squiffyApi, element } = await initScript("Hello world");
    let defaultOutput = getSectionContent(element, "_default");
    expect(defaultOutput).toBe("Hello world");
    expect(element.innerHTML).toMatchSnapshot();

    const updated = await compile("Updated content");
    squiffyApi.update(updated.story);
    defaultOutput = getSectionContent(element, "_default");
    expect(defaultOutput).toBe("Updated content");
    expect(element.innerHTML).toMatchSnapshot();
});

test.each(["a", "a'1"])('Update passage output - passage name "%s"', async (name) => {
    const { squiffyApi, element } = await initScript(`Click this: [${name}]

[${name}]:
Passage a content`);
    
    const link = findLink(element, "passage", name);
    const handled = await squiffyApi.clickLink(link);
    expect(handled).toBe(true);

    let defaultOutput = getSectionContent(element, "_default");
    expect(defaultOutput).toBe(`Click this: ${name}`);
    let passageOutput = getPassageContent(element, "_default", name);
    expect(passageOutput).toBe("Passage a content");
    expect(element.innerHTML).toMatchSnapshot();

    const updated = await compile(`Click this: [${name}]

[${name}]:
Updated passage content`);

    squiffyApi.update(updated.story);

    defaultOutput = getSectionContent(element, "_default");
    expect(defaultOutput).toBe(`Click this: ${name}`);

    passageOutput = getPassageContent(element, "_default", name);
    expect(passageOutput).toBe("Updated passage content");
    expect(element.innerHTML).toMatchSnapshot();
});

test("Delete section", async () => {
    const { squiffyApi, element } = await initScript(`Click this: [[a]]

[[a]]:
New section`);
    
    const link = findLink(element, "section", "a");
    const handled = await squiffyApi.clickLink(link);
    expect(handled).toBe(true);

    let defaultOutput = getSectionContent(element, "_default");
    expect(defaultOutput).toBe("Click this: a");
    let sectionOutput = getSectionContent(element, "a");
    expect(sectionOutput).toBe("New section");
    expect(element.innerHTML).toMatchSnapshot();

    const updated = await compile("Click this: [[a]]");

    squiffyApi.update(updated.story);

    defaultOutput = getSectionContent(element, "_default");
    expect(defaultOutput).toBe("Click this: a");
    sectionOutput = getSectionContent(element, "a");
    expect(sectionOutput).toBeNull();

    expect(element.innerHTML).toMatchSnapshot();
});

test("Delete passage", async () => {
    const { squiffyApi, element } = await initScript(`Click this: [a]

[a]:
New passage`);
    
    const link = findLink(element, "passage", "a");
    const handled = await squiffyApi.clickLink(link);
    expect(handled).toBe(true);

    let defaultOutput = getSectionContent(element, "_default");
    expect(defaultOutput).toBe("Click this: a");
    let passageOutput = getPassageContent(element, "_default", "a");
    expect(passageOutput).toBe("New passage");
    expect(element.innerHTML).toMatchSnapshot();

    const updated = await compile("Click this: [a]");

    squiffyApi.update(updated.story);

    defaultOutput = getSectionContent(element, "_default");
    expect(defaultOutput).toBe("Click this: a");
    passageOutput = getPassageContent(element, "_default", "a");
    expect(passageOutput).toBeNull();

    expect(element.innerHTML).toMatchSnapshot();
});

test("Clicked passage links remain disabled after an update", async () => {
    const { squiffyApi, element } = await initScript(`Click one of these: [a] [b]

[a]:
Output for passage A.

[b]:
Output for passage B.`);

    // click linkA
    
    let linkA = findLink(element, "passage", "a");
    expect(linkA.classList).not.toContain("disabled");
    expect(await squiffyApi.clickLink(linkA)).toBe(true);

    const updated = await compile(`Click one of these (updated): [a] [b]

[a]:
Output for passage A.

[b]:
Output for passage B.`);

    squiffyApi.update(updated.story);

    // linkA should still be disabled

    linkA = findLink(element, "passage", "a");
    expect(linkA.classList).toContain("disabled");
    expect(await squiffyApi.clickLink(linkA)).toBe(false);

    // linkB should still be enabled

    const linkB = findLink(element, "passage", "b");
    expect(linkB.classList).not.toContain("disabled");
    expect(await squiffyApi.clickLink(linkB)).toBe(true);
});

test("Deleting the current section activates the previous section", async () => {
    const { squiffyApi, element } = await initScript(`Choose a section: [[a]] [[b]], or passage [start1].
    
[start1]:
Output for passage start1.

[[a]]:
Output for section A.

[[b]]:
Output for section B.`);

    // click linkA

    const linkA = findLink(element, "section", "a");
    let linkB = findLink(element, "section", "b");
    expect(linkA.classList).not.toContain("disabled");
    expect(await squiffyApi.clickLink(linkA)).toBe(true);

    // can't click start1 passage as we're in section [[a]] now
    let linkStart1 = findLink(element, "passage", "start1");
    expect(await squiffyApi.clickLink(linkStart1)).toBe(false);

    // can't click linkB as we're in section [[a]] now
    expect(await squiffyApi.clickLink(linkB)).toBe(false);

    // now we delete section [[a]]

    const updated = await compile(`Choose a section: [[a]] [[b]], or passage [start1].
    
[start1]:
Output for passage start1.

[[b]]:
Output for section B. Here's a passage: [b1].

[b1]:
Passage in section B.`);

    squiffyApi.update(updated.story);

    // We're in the first section, so the start1 passage should be clickable now
    linkStart1 = findLink(element, "passage", "start1");
    expect(await squiffyApi.clickLink(linkStart1)).toBe(true);

    // We're in the first section, so linkB should be clickable now
    linkB = findLink(element, "section", "b");
    expect(await squiffyApi.clickLink(linkB)).toBe(true);

    // and the passage [b1] within it should be clickable
    const linkB1 = findLink(element, "passage", "b1");
    expect(await squiffyApi.clickLink(linkB1)).toBe(true);
});

test("Embed text from a section", async () => {
    const script = `
[[section1]]:
Here is some text from the next section: {{embed "section2"}}

[[section2]]:
Text from next section.
`;

    const { element } = await initScript(script);

    const output = getSectionContent(element, "section1");
    expect(output).toBe("Here is some text from the next section: Text from next section.");
});

test("Embed text from a passage", async () => {
    const script = `
[[section1]]:
Here is some text from a passage: {{embed "passage"}}

[passage]:
Text from a passage.
`;

    const { element } = await initScript(script);

    const output = getSectionContent(element, "section1");
    expect(output).toBe("Here is some text from a passage: Text from a passage.");
});

test("Update section with embedded text", async () => {
    const script = `
[[section1]]:
Here is some text from the next section: {{embed "section2"}}

[[section2]]:
Text from next section.
`;

    const { squiffyApi, element } = await initScript(script);

    let output = getSectionContent(element, "section1");
    expect(output).toBe("Here is some text from the next section: Text from next section.");

    const script2 = `
[[section1]]:
Here is an updated script with text from the next section: {{embed "section2"}}

[[section2]]:
Updated text from next section.
`;

    const updated = await compile(script2);
    squiffyApi.update(updated.story);
    output = getSectionContent(element, "section1");

    // NOTE: The embedded text does not currently get updated. We would need to track where the embedded
    // text has been written.
    expect(output).toBe("Here is an updated script with text from the next section: Text from next section.");
});

test("Update passage with embedded text", async () => {
    const script = `
[[section1]]:
Here is some text from a passage: {{embed "passage"}}

[passage]:
Text from a passage.
`;

    const { squiffyApi, element } = await initScript(script);

    let output = getSectionContent(element, "section1");
    expect(output).toBe("Here is some text from a passage: Text from a passage.");

    const script2 = `
[[section1]]:
Here is an updated script with text from a passage: {{embed "passage"}}

[passage]:
Updated text from a passage.
`;

    const updated = await compile(script2);
    squiffyApi.update(updated.story);
    output = getSectionContent(element, "section1");

    // NOTE: The embedded text does not currently get updated. We would need to track where the embedded
    // text has been written.
    expect(output).toBe("Here is an updated script with text from a passage: Text from a passage.");
});

test("Clear entire script, then update", async () => {
    const script = "Original content";

    const { squiffyApi, element } = await initScript(script);

    let output = getSectionContent(element, "_default");
    expect(output).toBe("Original content");

    const script2 = "";
    const update2 = await compile(script2);
    squiffyApi.update(update2.story);
    output = getSectionContent(element, "_default");
    expect(output).toBeNull();

    const script3 = "New content";
    const update3 = await compile(script3);
    squiffyApi.update(update3.story);
    output = getSectionContent(element, "_default");
    expect(output).toBe("New content");
});

test("Changing the start section", async () => {
    const script = "Original content in default section";

    const { squiffyApi, element } = await initScript(script);

    let output = getSectionContent(element, "_default");
    expect(output).toBe("Original content in default section");

    const script2 = `[[new]]:
This is the new start section`;
    const update2 = await compile(script2);
    squiffyApi.update(update2.story);
    output = getSectionContent(element, "new");
    expect(output).toBe("This is the new start section");
});

test("Going back handling @clear and attribute changes", async () => {
    const script = `
Choose: [a], [b]

[a]:
@set test = 123
You chose a. Now [[continue]]

[b]:
@set test = 456
You chose b. Now [[continue]]

[[continue]]:
@set test = 789
Now choose: [c], [d]

[c]:
@clear
@set test = 321
You chose c. Now [[finish]]

[d]:
You chose d. Now [[finish]]

[[finish]]:
Done.
`;

    const { squiffyApi, element } = await initScript(script);

    const linkA = findLink(element, "passage", "a");

    // Click link to "a"
    await squiffyApi.clickLink(linkA);

    // "a" should be marked as seen
    expect(squiffyApi.get("_seen_sections") as []).toContain("a");
    expect(squiffyApi.get("test")).toBe(123);

    // Go back
    squiffyApi.goBack();

    // "a" should not be marked as seen
    expect(squiffyApi.get("_seen_sections") as []).not.toContain("a");
    expect(squiffyApi.get("test")).toBe(null);

    // Click link to "b", then click link to "continue"
    let linkB = findLink(element, "passage", "b");
    await squiffyApi.clickLink(linkB);
    expect(squiffyApi.get("test")).toBe(456);
    let continueLink = findLink(element, "section", "continue");
    await squiffyApi.clickLink(continueLink);

    expect(squiffyApi.get("_seen_sections") as []).toContain("b");
    expect(squiffyApi.get("test")).toBe(789);

    // Go back
    squiffyApi.goBack();

    // "b" should still be marked as seen, because we didn't go back that far yet
    expect(squiffyApi.get("_seen_sections") as []).toContain("b");
    expect(squiffyApi.get("test")).toBe(456);

    // Go back
    squiffyApi.goBack();

    // Now "b" should not be marked as seen
    expect(squiffyApi.get("_seen_sections") as []).not.toContain("b");
    expect(squiffyApi.get("test")).toBe(null);

    // Click "b" again, then "continue", and "c", which clears the screen
    linkB = findLink(element, "passage", "b");
    await squiffyApi.clickLink(linkB);
    continueLink = findLink(element, "section", "continue");
    await squiffyApi.clickLink(continueLink);
    const linkC = findLink(element, "passage", "c");
    await squiffyApi.clickLink(linkC);

    // Should match snapshot, where passage "c" is the only thing visible
    expect(element.innerHTML).toMatchSnapshot();
    expect(squiffyApi.get("test")).toBe(321);

    // Go back
    squiffyApi.goBack();

    // Should match snapshot, where the previous text is visible again
    expect(element.innerHTML).toMatchSnapshot();
    expect(squiffyApi.get("test")).toBe(789);
});
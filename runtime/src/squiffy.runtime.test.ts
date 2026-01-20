import { expect, test, beforeEach, afterEach, beforeAll, vi } from "vitest";
import fs from "fs/promises";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";

// Mock crypto.randomUUID() to return a stable value for tests
beforeAll(() => {
    const mockUUID = "00000000-0000-0000-0000-000000000000";
    vi.stubGlobal("crypto", {
        randomUUID: () => mockUUID
    });
});

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

const compile = async (script: string, scriptBaseFilename?: string) => {
    const compileResult = await squiffyCompile({
        script: script,
        scriptBaseFilename: scriptBaseFilename,
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
    localStorage.clear();
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

test("Update @set directive in section re-renders text", async () => {
    const script = `@set score = 75

Your score is {{score}}.`;

    const { squiffyApi, element } = await initScript(script);

    let output = getSectionContent(element, "_default");
    expect(output).toBe("Your score is 75.");

    const script2 = `@set score = 100

Your score is {{score}}.`;
    const update2 = await compile(script2);
    squiffyApi.update(update2.story);

    output = getSectionContent(element, "_default");
    expect(output).toBe("Your score is 100.");
});

test("Update @set directive in passage re-renders text", async () => {
    const script = `Click [here]

[here]:
@set score = 75
Your score is {{score}}.`;

    const { squiffyApi, element } = await initScript(script);

    const link = findLink(element, "passage", "here");
    await squiffyApi.clickLink(link);

    let output = getPassageContent(element, "_default", "here");
    expect(output).toBe("Your score is 75.");

    const script2 = `Click [here]

[here]:
@set score = 100
Your score is {{score}}.`;
    const update2 = await compile(script2);
    squiffyApi.update(update2.story);

    output = getPassageContent(element, "_default", "here");
    expect(output).toBe("Your score is 100.");
});

test("Adding @set directive updates text", async () => {
    const script = "Your score is {{score}}.";

    const { squiffyApi, element } = await initScript(script);

    let output = getSectionContent(element, "_default");
    expect(output).toBe("Your score is .");

    const script2 = `@set score = 50

Your score is {{score}}.`;
    const update2 = await compile(script2);
    squiffyApi.update(update2.story);

    output = getSectionContent(element, "_default");
    expect(output).toBe("Your score is 50.");
});

test("Removing @set directive updates text", async () => {
    const script = `@set score = 75

Your score is {{score}}.`;

    const { squiffyApi, element } = await initScript(script);

    let output = getSectionContent(element, "_default");
    expect(output).toBe("Your score is 75.");

    // Note: Removing the @set doesn't unset the variable, but the text should still re-render
    // with whatever the current state is (still 75 in this case since we didn't unset it)
    const script2 = "Your score is {{score}}.";
    const update2 = await compile(script2);
    squiffyApi.update(update2.story);

    output = getSectionContent(element, "_default");
    expect(output).toBe("Your score is 75.");
});

test("Update multiple @set directives", async () => {
    const script = `@set name = Alice
@set score = 100

Hello {{name}}, your score is {{score}}.`;

    const { squiffyApi, element } = await initScript(script);

    let output = getSectionContent(element, "_default");
    expect(output).toBe("Hello Alice, your score is 100.");

    const script2 = `@set name = Bob
@set score = 200

Hello {{name}}, your score is {{score}}.`;
    const update2 = await compile(script2);
    squiffyApi.update(update2.story);

    output = getSectionContent(element, "_default");
    expect(output).toBe("Hello Bob, your score is 200.");
});

test("Update boolean @set directive from true to false", async () => {
    const script = `@set has_key = true

{{#if has_key}}
You have the key.
{{else}}
You don't have the key.
{{/if}}`;

    const { squiffyApi, element } = await initScript(script);

    let output = getSectionContent(element, "_default");
    expect(output).toBe("You have the key.");

    const script2 = `@set has_key = false

{{#if has_key}}
You have the key.
{{else}}
You don't have the key.
{{/if}}`;
    const update2 = await compile(script2);
    squiffyApi.update(update2.story);

    output = getSectionContent(element, "_default");
    expect(output).toBe("You don't have the key.");
});

test("Update boolean @set directive from false to true", async () => {
    const script = `@set has_key = false

{{#if has_key}}
You have the key.
{{else}}
You don't have the key.
{{/if}}`;

    const { squiffyApi, element } = await initScript(script);

    let output = getSectionContent(element, "_default");
    expect(output).toBe("You don't have the key.");

    const script2 = `@set has_key = true

{{#if has_key}}
You have the key.
{{else}}
You don't have the key.
{{/if}}`;
    const update2 = await compile(script2);
    squiffyApi.update(update2.story);

    output = getSectionContent(element, "_default");
    expect(output).toBe("You have the key.");
});

test("Boolean values work correctly with logic helpers", async () => {
    const script = `@set has_key = true
@set door_locked = true

{{#if (and has_key door_locked)}}
You unlock the door.
{{else}}
Cannot unlock.
{{/if}}`;

    const { squiffyApi, element } = await initScript(script);

    let output = getSectionContent(element, "_default");
    expect(output).toBe("You unlock the door.");

    // Change has_key to false
    const script2 = `@set has_key = false
@set door_locked = true

{{#if (and has_key door_locked)}}
You unlock the door.
{{else}}
Cannot unlock.
{{/if}}`;
    const update2 = await compile(script2);
    squiffyApi.update(update2.story);

    output = getSectionContent(element, "_default");
    expect(output).toBe("Cannot unlock.");
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

// State Persistence Tests
test("State persistence: attributes saved to localStorage", async () => {
    const script = `
[[start]]:
@set score = 100
@set name = Player
Score: {score}, Name: {name}
`;

    const element = document.getElementById("squiffy")!;
    const compileResult = await compile(script, "test-story-123.squiffy");

    // Initialize with persistence enabled (using GUID like file:// protocol games would)
    const squiffyApi = await init({
        element: element,
        story: compileResult.story,
        persist: true,
        storyId: "00000000-0000-0000-0000-000000000000",
    });

    await squiffyApi.begin();

    // Verify attributes are set
    expect(squiffyApi.get("score")).toBe(100);
    expect(squiffyApi.get("name")).toBe("Player");

    // Verify localStorage contains the values with correct prefixes (using the GUID from story.id)
    expect(localStorage["00000000-0000-0000-0000-000000000000-score"]).toBe("100");
    expect(localStorage["00000000-0000-0000-0000-000000000000-name"]).toBe('"Player"');

    // Clean up localStorage
    localStorage.clear();
});

test("State persistence: load state from localStorage", async () => {
    const script = `
[[start]]:
Score: {score}, Name: {name}
`;

    // Pre-populate localStorage with state (using the mocked GUID)
    localStorage["00000000-0000-0000-0000-000000000000-score"] = "250";
    localStorage["00000000-0000-0000-0000-000000000000-name"] = '"SavedPlayer"';
    localStorage["00000000-0000-0000-0000-000000000000-level"] = "5";

    const element = document.getElementById("squiffy")!;
    const compileResult = await compile(script, "persist-load-test.squiffy");

    // Initialize with persistence enabled - should load from localStorage (using GUID like file:// protocol games would)
    const squiffyApi = await init({
        element: element,
        story: compileResult.story,
        persist: true,
        storyId: "00000000-0000-0000-0000-000000000000",
    });

    await squiffyApi.begin();

    // Verify state was loaded from localStorage
    expect(squiffyApi.get("score")).toBe(250);
    expect(squiffyApi.get("name")).toBe("SavedPlayer");
    expect(squiffyApi.get("level")).toBe(5);

    // Clean up localStorage
    localStorage.clear();
});

test("State persistence: restart clears localStorage", async () => {
    const script = `
[[start]]:
@set data = important
Content here.
`;

    const element = document.getElementById("squiffy")!;
    const compileResult = await compile(script, "reset-test.squiffy");

    const squiffyApi = await init({
        element: element,
        story: compileResult.story,
        persist: true,
        storyId: "00000000-0000-0000-0000-000000000000",
    });

    await squiffyApi.begin();

    // Verify state is set in localStorage (using the GUID)
    expect(localStorage["00000000-0000-0000-0000-000000000000-data"]).toBe('"important"');
    expect(squiffyApi.get("data")).toBe("important");

    // Restart the story
    squiffyApi.restart();

    // Verify localStorage is cleared
    expect(localStorage["00000000-0000-0000-0000-000000000000-data"]).toBeUndefined();
    expect(squiffyApi.get("data")).toBe(null);

    // Clean up localStorage
    localStorage.clear();
});

test("State persistence: disabled when persist is false", async () => {
    const script = `
[[start]]:
@set value = 42
Value: {value}
`;

    const element = document.getElementById("squiffy")!;
    const compileResult = await compile(script, "no-persist-test.squiffy");

    // Initialize with persistence disabled
    const squiffyApi = await init({
        element: element,
        story: compileResult.story,
        persist: false,
    });

    await squiffyApi.begin();

    // Verify attribute is set in memory
    expect(squiffyApi.get("value")).toBe(42);

    // Verify nothing is saved to localStorage
    expect(localStorage["no-persist-test.squiffy-value"]).toBeUndefined();

    // Clean up localStorage
    localStorage.clear();
});

test("State persistence: complex objects serialized correctly", async () => {
    const script = `
[[start]]:
Content here.
`;

    const element = document.getElementById("squiffy")!;
    const compileResult = await compile(script, "complex-persist.squiffy");

    const squiffyApi = await init({
        element: element,
        story: compileResult.story,
        persist: true,
        storyId: "00000000-0000-0000-0000-000000000000",
    });

    await squiffyApi.begin();

    // Set complex objects via the API
    squiffyApi.set("inventory", ["sword", "shield", "potion"]);
    squiffyApi.set("player", { health: 100, mana: 50 });

    // Verify complex objects are saved and can be retrieved
    const inventory = squiffyApi.get("inventory");
    expect(inventory).toEqual(["sword", "shield", "potion"]);

    const player = squiffyApi.get("player");
    expect(player).toEqual({ health: 100, mana: 50 });

    // Verify localStorage contains serialized JSON (using the GUID from story.id)
    expect(JSON.parse(localStorage["00000000-0000-0000-0000-000000000000-inventory"])).toEqual(["sword", "shield", "potion"]);
    expect(JSON.parse(localStorage["00000000-0000-0000-0000-000000000000-player"])).toEqual({ health: 100, mana: 50 });

    // Clean up localStorage
    localStorage.clear();
});

test("State persistence: seen sections tracked correctly", async () => {
    const script = `
[[start]]:
Go to: [[section1]], [[section2]]

[[section1]]:
Section 1 content.

[[section2]]:
Section 2 content.
`;

    const element = document.getElementById("squiffy")!;
    const compileResult = await compile(script, "seen-persist.squiffy");

    const squiffyApi = await init({
        element: element,
        story: compileResult.story,
        persist: true,
        storyId: "00000000-0000-0000-0000-000000000000",
    });

    await squiffyApi.begin();

    // Click section1
    const link1 = findLink(element, "section", "section1");
    await squiffyApi.clickLink(link1);

    // Verify section1 is marked as seen
    const seenSections = squiffyApi.get("_seen_sections");
    expect(seenSections).toContain("section1");

    // Verify it's saved to localStorage (using the GUID)
    expect(localStorage["00000000-0000-0000-0000-000000000000-_seen_sections"]).toBeDefined();
    const storedSeen = JSON.parse(localStorage["00000000-0000-0000-0000-000000000000-_seen_sections"]);
    expect(storedSeen).toContain("section1");

    // Clean up localStorage
    localStorage.clear();
});

test("State persistence: state isolation between different storyIds", async () => {
    const scriptA = `
[[start]]:
Content.
`;

    const scriptB = `
[[start]]:
Content.
`;

    const element = document.getElementById("squiffy")!;
    const compileResultA = await compile(scriptA, "story-A.squiffy");

    // Initialize first story
    const api1 = await init({
        element: element,
        story: compileResultA.story,
        persist: true,
        storyId: "story-A.squiffy",
    });

    await api1.begin();
    api1.set("shared", "Story A value");

    // Verify localStorage for story A
    expect(localStorage["story-A.squiffy-shared"]).toBe('"Story A value"');

    // Reset and initialize second story with different storyId
    element.innerHTML = "";
    const compileResultB = await compile(scriptB, "story-B.squiffy");
    const api2 = await init({
        element: element,
        story: compileResultB.story,
        persist: true,
        storyId: "story-B.squiffy",
    });

    await api2.begin();
    api2.set("shared", "Story B value");

    // Verify localStorage for story B
    expect(localStorage["story-B.squiffy-shared"]).toBe('"Story B value"');

    // Verify both stories have independent state
    expect(localStorage["story-A.squiffy-shared"]).toBe('"Story A value"');
    expect(localStorage["story-B.squiffy-shared"]).toBe('"Story B value"');

    // Clean up localStorage
    localStorage.clear();
});

test("State persistence: restart only clears current storyId", async () => {
    // Pre-populate localStorage with data from multiple stories
    localStorage["story1.squiffy-data"] = '"story1 value"';
    localStorage["story2.squiffy-data"] = '"story2 value"';
    localStorage["other-key"] = '"unrelated"';

    const script = "[[start]]:";
    const element = document.getElementById("squiffy")!;
    const compileResult = await compile(script, "story1.squiffy");

    const squiffyApi = await init({
        element: element,
        story: compileResult.story,
        persist: true,
        storyId: "story1.squiffy",
    });

    await squiffyApi.begin();

    // Restart story1
    squiffyApi.restart();

    // Verify only story1 data is cleared
    expect(localStorage["story1.squiffy-data"]).toBeUndefined();
    expect(localStorage["story2.squiffy-data"]).toBe('"story2 value"');
    expect(localStorage["other-key"]).toBe('"unrelated"');

    // Clean up localStorage
    localStorage.clear();
});

// Edge Case Tests
test("Edge case: Unicode and emoji in content", async () => {
    const script = `
[[start]]:
Hello! 你好! مرحبا! 🌍🎉

Click here: [[next]]

[[next]]:
More unicode: ñ, é, ü, ö, ß
Emoji: 👍 💯 🚀
`;

    const { squiffyApi, element } = await initScript(script);

    const content = getSectionContent(element, "start");
    expect(content).toContain("你好");
    expect(content).toContain("🌍🎉");

    const link = findLink(element, "section", "next");
    await squiffyApi.clickLink(link);

    const nextContent = getSectionContent(element, "next");
    expect(nextContent).toContain("ñ, é, ü, ö, ß");
    expect(nextContent).toContain("👍 💯 🚀");
});

test("Edge case: Special characters in section names", async () => {
    const script = `
[[start]]:
Go to: [[section-with-dashes]], [[section_with_underscores]], [[section with spaces]]

[[section-with-dashes]]:
Dashes work!

[[section_with_underscores]]:
Underscores work!

[[section with spaces]]:
Spaces work!
`;

    const { squiffyApi, element } = await initScript(script);

    const link1 = findLink(element, "section", "section-with-dashes");
    await squiffyApi.clickLink(link1);
    expect(getSectionContent(element, "section-with-dashes")).toBe("Dashes work!");
});

test("Edge case: Empty sections and passages", async () => {
    const script = `
[[start]]:
[empty passage]

[[empty section]]:

[empty passage]:
`;

    const { element } = await initScript(script);

    // Empty section should be rendered
    expect(element.querySelector('[data-section="empty section"]')).toBeDefined();
});

test("Edge case: Very long attribute values", async () => {
    const longString = "a".repeat(10000);

    const script = `
[[start]]:
Content here.
`;

    const { squiffyApi } = await initScript(script);

    // Set a very long attribute value
    squiffyApi.set("longValue", longString);

    // Verify it can be retrieved
    const retrieved = squiffyApi.get("longValue");
    expect(retrieved.length).toBe(10000);
    expect(retrieved).toBe(longString);
});

test("Edge case: Attributes with underscores", async () => {
    const script = `
[[start]]:
@set test_value = 123
@set another_test = 456
Value: {test_value} and {another_test}
`;

    const { squiffyApi } = await initScript(script);

    expect(squiffyApi.get("test_value")).toBe(123);
    expect(squiffyApi.get("another_test")).toBe(456);
});

test("Edge case: Multiple consecutive link clicks", async () => {
    const script = `
[[start]]:
Click: [a], [b], [c]

[a]:
A clicked

[b]:
B clicked

[c]:
C clicked
`;

    const { squiffyApi, element } = await initScript(script);

    // Click all three passages in quick succession
    const linkA = findLink(element, "passage", "a");
    const linkB = findLink(element, "passage", "b");
    const linkC = findLink(element, "passage", "c");

    await squiffyApi.clickLink(linkA);
    await squiffyApi.clickLink(linkB);
    await squiffyApi.clickLink(linkC);

    // All three should be present (they're in the "start" section, not "_default")
    expect(getPassageContent(element, "start", "a")).toBe("A clicked");
    expect(getPassageContent(element, "start", "b")).toBe("B clicked");
    expect(getPassageContent(element, "start", "c")).toBe("C clicked");
});

test("Edge case: Attribute with null and undefined values", async () => {
    const script = `
[[start]]:
Content.
`;

    const { squiffyApi } = await initScript(script);

    // Get non-existent attribute
    expect(squiffyApi.get("nonexistent")).toBe(null);

    // Set attribute to undefined (should convert to true)
    squiffyApi.set("testAttr", undefined);
    expect(squiffyApi.get("testAttr")).toBe(true);
});

test("Edge case: Section with only whitespace", async () => {
    const script = `
[[start]]:
Go to: [[whitespace]]

[[whitespace]]:

`;

    const { squiffyApi, element } = await initScript(script);

    const link = findLink(element, "section", "whitespace");
    await squiffyApi.clickLink(link);

    // Section should exist even if empty
    const section = element.querySelector('[data-section="whitespace"]');
    expect(section).not.toBeNull();
});

// State modification helper tests
test("{{set}} helper sets attribute value", async () => {
    const script = `
[[start]]:
{{set "score" 100}}
Score is {{score}}.
`;

    const { squiffyApi } = await initScript(script);
    expect(squiffyApi.get("score")).toBe(100);
});

test("{{set}} helper with string value", async () => {
    const script = `
[[start]]:
{{set "name" "Alice"}}
Name is {{name}}.
`;

    const { squiffyApi } = await initScript(script);
    expect(squiffyApi.get("name")).toBe("Alice");
});

test("{{unset}} helper sets attribute to false", async () => {
    const script = `
[[start]]:
@set flag
{{unset "flag"}}
Done.
`;

    const { squiffyApi } = await initScript(script);
    expect(squiffyApi.get("flag")).toBe(false);
});

test("{{inc}} helper increments attribute by 1", async () => {
    const script = `
[[start]]:
@set counter = 5
{{inc "counter"}}
Counter is {{counter}}.
`;

    const { squiffyApi } = await initScript(script);
    expect(squiffyApi.get("counter")).toBe(6);
});

test("{{inc}} helper increments by specified amount", async () => {
    const script = `
[[start]]:
@set counter = 10
{{inc "counter" 5}}
Counter is {{counter}}.
`;

    const { squiffyApi } = await initScript(script);
    expect(squiffyApi.get("counter")).toBe(15);
});

test("{{inc}} helper starts from 0 for unset attributes", async () => {
    const script = `
[[start]]:
{{inc "newCounter"}}
Counter is {{newCounter}}.
`;

    const { squiffyApi } = await initScript(script);
    expect(squiffyApi.get("newCounter")).toBe(1);
});

test("{{dec}} helper decrements attribute by 1", async () => {
    const script = `
[[start]]:
@set counter = 10
{{dec "counter"}}
Counter is {{counter}}.
`;

    const { squiffyApi } = await initScript(script);
    expect(squiffyApi.get("counter")).toBe(9);
});

test("{{dec}} helper decrements by specified amount", async () => {
    const script = `
[[start]]:
@set counter = 20
{{dec "counter" 7}}
Counter is {{counter}}.
`;

    const { squiffyApi } = await initScript(script);
    expect(squiffyApi.get("counter")).toBe(13);
});

test("{{inc}} inside {{#if}} only executes when condition is true", async () => {
    const script = `
[[start]]:
@set score = 0
@set condition
{{#if condition}}{{inc "score"}}Condition was true.{{/if}}
Score is {{score}}.
`;

    const { squiffyApi } = await initScript(script);
    expect(squiffyApi.get("score")).toBe(1);
});

test("{{inc}} inside {{#if}} does NOT execute when condition is false", async () => {
    const script = `
[[start]]:
@set score = 0
@set not condition
{{#if condition}}{{inc "score"}}Condition was true.{{/if}}
Score is {{score}}.
`;

    const { squiffyApi } = await initScript(script);
    expect(squiffyApi.get("score")).toBe(0);
});

test("{{set}} inside {{#if}} only executes when condition is true", async () => {
    const script = `
[[start]]:
@set flag
{{#if flag}}{{set "result" "yes"}}{{else}}{{set "result" "no"}}{{/if}}
Result: {{result}}.
`;

    const { squiffyApi } = await initScript(script);
    expect(squiffyApi.get("result")).toBe("yes");
});

test("{{set}} inside {{else}} executes when condition is false", async () => {
    const script = `
[[start]]:
@set not flag
{{#if flag}}{{set "result" "yes"}}{{else}}{{set "result" "no"}}{{/if}}
Result: {{result}}.
`;

    const { squiffyApi } = await initScript(script);
    expect(squiffyApi.get("result")).toBe("no");
});

test("State modification helpers produce no output", async () => {
    const script = `
[[start]]:
Before{{set "x" 1}}{{inc "y"}}{{dec "z"}}{{unset "w"}}After
`;

    const { element } = await initScript(script);
    const content = getSectionContent(element, "start");
    expect(content).toBe("BeforeAfter");
});

test("Multiple {{inc}} calls accumulate correctly", async () => {
    const script = `
[[start]]:
@set counter = 0
{{inc "counter"}}{{inc "counter"}}{{inc "counter"}}
Counter is {{counter}}.
`;

    const { squiffyApi } = await initScript(script);
    expect(squiffyApi.get("counter")).toBe(3);
});

test("{{inc}} with seen() condition in practical example", async () => {
    const script = `
[[start]]:
@set relationship = 0
Talk to [friend].

[friend]:
{{#if (seen "previous chat")}}{{inc "relationship"}}You talked before!{{else}}First time meeting.{{/if}}
Relationship: {{relationship}}.

[previous chat]:
Had a chat.
`;

    const { squiffyApi, element } = await initScript(script);

    // Click friend link - should NOT increment (haven't seen "previous chat")
    const friendLink = findLink(element, "passage", "friend");
    await squiffyApi.clickLink(friendLink);
    expect(squiffyApi.get("relationship")).toBe(0);
});

test("{{attribute}} reflects changes from {{inc}} in same render pass", async () => {
    const script = `
[[start]]:
@set score = 0
{{inc "score" 5}}
Score is now {{score}}.
`;

    const { squiffyApi, element } = await initScript(script);

    // The score should be 5, and the text should reflect the updated value
    expect(squiffyApi.get("score")).toBe(5);
    const content = getSectionContent(element, "start");
    expect(content).toBe("Score is now 5.");
});

test("Multiple {{inc}} and {{attribute}} reads work correctly in sequence", async () => {
    const script = `
[[start]]:
@set x = 0
Start: {{x}}. {{inc "x"}}After first inc: {{x}}. {{inc "x" 10}}After second inc: {{x}}.
`;

    const { squiffyApi, element } = await initScript(script);

    expect(squiffyApi.get("x")).toBe(11);
    const content = getSectionContent(element, "start");
    expect(content).toBe("Start: 0. After first inc: 1. After second inc: 11.");
});

test("{{at}} helper returns true when at specified section", async () => {
    const script = `
[[start]]:
{{#if (at "start")}}Currently at start.{{else}}Not at start.{{/if}}
Go to [[next]].

[[next]]:
{{#if (at "start")}}At start.{{else}}Not at start anymore.{{/if}}
{{#if (at "next")}}Now at next.{{/if}}
`;

    const { squiffyApi, element } = await initScript(script);

    let content = getSectionContent(element, "start");
    expect(content).toContain("Currently at start.");

    const nextLink = findLink(element, "section", "next");
    await squiffyApi.clickLink(nextLink);

    content = getSectionContent(element, "next");
    expect(content).toContain("Not at start anymore.");
    expect(content).toContain("Now at next.");
});

test("{{at}} helper with array returns true when at any of specified sections", async () => {
    const script = `
[[start]]:
{{#if (at (array "start" "other"))}}At start or other.{{else}}Elsewhere.{{/if}}
Go to [[next]].

[[next]]:
{{#if (at (array "start" "other"))}}At start or other.{{else}}Not at start or other.{{/if}}
{{#if (at (array "next" "another"))}}At next or another.{{/if}}
`;

    const { squiffyApi, element } = await initScript(script);

    let content = getSectionContent(element, "start");
    expect(content).toContain("At start or other.");

    const nextLink = findLink(element, "section", "next");
    await squiffyApi.clickLink(nextLink);

    content = getSectionContent(element, "next");
    expect(content).toContain("Not at start or other.");
    expect(content).toContain("At next or another.");
});

test("Input validation: links are disabled when required input is empty", async () => {
    const script = `
Enter your name: <input type="text" data-attribute="player_name" required>

[[Continue]]

[[Continue]]:
Hello, {{player_name}}!
`;

    const { squiffyApi, element } = await initScript(script);

    // Find the section link
    const continueLink = findLink(element, "section", "Continue", true);

    // Initially link should be disabled because required input is empty
    expect(continueLink.classList.contains("validation-disabled")).toBe(true);
    expect(continueLink.getAttribute("aria-disabled")).toBe("true");

    // Try to click - should not navigate
    await squiffyApi.clickLink(continueLink);
    expect(element.querySelectorAll(".squiffy-output-section").length).toBe(1);
});

test("Input validation: links are enabled when required input is filled", async () => {
    const script = `
Enter your name: <input type="text" data-attribute="player_name" required>

[[Continue]]

[[Continue]]:
Hello, {{player_name}}!
`;

    const { squiffyApi, element } = await initScript(script);

    // Find the input and link
    const input = element.querySelector('input[data-attribute="player_name"]') as HTMLInputElement;
    const continueLink = findLink(element, "section", "Continue", true);

    // Fill the input
    input.value = "Alice";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Link should now be enabled
    expect(continueLink.classList.contains("validation-disabled")).toBe(false);
    expect(continueLink.hasAttribute("aria-disabled")).toBe(false);

    // Click should work
    await squiffyApi.clickLink(continueLink);
    expect(element.querySelectorAll(".squiffy-output-section").length).toBe(2);
    expect(getSectionContent(element, "Continue")).toContain("Hello, Alice!");
});

test("Input validation: clearing input re-disables links", async () => {
    const script = `
Enter your name: <input type="text" data-attribute="player_name" required>

[[Continue]]

[[Continue]]:
Hello, {{player_name}}!
`;

    const { squiffyApi, element } = await initScript(script);

    const input = element.querySelector('input[data-attribute="player_name"]') as HTMLInputElement;
    const continueLink = findLink(element, "section", "Continue", true);

    // Fill the input
    input.value = "Test";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Link should be enabled
    expect(continueLink.classList.contains("validation-disabled")).toBe(false);

    // Clear the input
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Link should be disabled again
    expect(continueLink.classList.contains("validation-disabled")).toBe(true);

    // Try to click - should not navigate
    await squiffyApi.clickLink(continueLink);
    expect(element.querySelectorAll(".squiffy-output-section").length).toBe(1);
});

test("Input validation: passage links are also validated", async () => {
    const script = `
Enter your name: <input type="text" data-attribute="player_name" required>

You can [look around] or [check inventory].

[look around]:
You see a room.

[check inventory]:
Your pockets are empty.
`;

    const { squiffyApi, element } = await initScript(script);

    const input = element.querySelector('input[data-attribute="player_name"]') as HTMLInputElement;

    // Find passage links
    const lookLink = findLink(element, "passage", "look around");
    const inventoryLink = findLink(element, "passage", "check inventory");

    // Initially both should be disabled
    expect(lookLink.classList.contains("validation-disabled")).toBe(true);
    expect(inventoryLink.classList.contains("validation-disabled")).toBe(true);

    // Try to click - should not work
    await squiffyApi.clickLink(lookLink);
    expect(element.querySelectorAll(".squiffy-output-passage").length).toBe(0);

    // Fill the input
    input.value = "Bob";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Links should now be enabled
    expect(lookLink.classList.contains("validation-disabled")).toBe(false);
    expect(inventoryLink.classList.contains("validation-disabled")).toBe(false);

    // Click should work
    await squiffyApi.clickLink(lookLink);
    expect(element.querySelectorAll(".squiffy-output-passage").length).toBe(1);
});

test("Input validation: multiple inputs all must be valid", async () => {
    const script = `
Name: <input type="text" data-attribute="name" required>
Age: <input type="number" data-attribute="age" required min="1" max="120">

[[Continue]]

[[Continue]]:
Name: {{name}}, Age: {{age}}
`;

    const { squiffyApi, element } = await initScript(script);

    const nameInput = element.querySelector('input[data-attribute="name"]') as HTMLInputElement;
    const ageInput = element.querySelector('input[data-attribute="age"]') as HTMLInputElement;
    const continueLink = findLink(element, "section", "Continue", true);

    // Initially disabled
    expect(continueLink.classList.contains("validation-disabled")).toBe(true);

    // Fill only name
    nameInput.value = "Charlie";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Still disabled because age is empty
    expect(continueLink.classList.contains("validation-disabled")).toBe(true);

    // Fill age with invalid value
    ageInput.value = "150";
    ageInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Still disabled because age is out of range
    expect(continueLink.classList.contains("validation-disabled")).toBe(true);

    // Fill age with valid value
    ageInput.value = "25";
    ageInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Now should be enabled
    expect(continueLink.classList.contains("validation-disabled")).toBe(false);

    // Click should work
    await squiffyApi.clickLink(continueLink);
    expect(element.querySelectorAll(".squiffy-output-section").length).toBe(2);
});

test("Input validation: validation resets when moving to new section", async () => {
    const script = `
Name: <input type="text" data-attribute="name" required>

[[Continue]]

[[Continue]]:
Email: <input type="email" data-attribute="email" required>

[[Finish]]

[[Finish]]:
Done!
`;

    const { squiffyApi, element } = await initScript(script);

    // Fill first input and navigate
    const nameInput = element.querySelector('input[data-attribute="name"]') as HTMLInputElement;
    nameInput.value = "Dave";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    const continueLink = findLink(element, "section", "Continue", true);
    await squiffyApi.clickLink(continueLink);

    // In second section, new input should block navigation
    const finishLink = findLink(element, "section", "Finish", true);
    expect(finishLink.classList.contains("validation-disabled")).toBe(true);

    // Fill email and continue
    const emailInput = element.querySelector('input[data-attribute="email"]') as HTMLInputElement;
    emailInput.value = "dave@example.com";
    emailInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(finishLink.classList.contains("validation-disabled")).toBe(false);

    await squiffyApi.clickLink(finishLink);
    expect(getSectionContent(element, "Finish")).toContain("Done!");
});

test("Input validation: disabled inputs are ignored", async () => {
    const script = `
Active: <input type="text" data-attribute="active" required>
Disabled: <input type="text" data-attribute="disabled" required disabled>

[[Continue]]

[[Continue]]:
Done!
`;

    const { squiffyApi, element } = await initScript(script);

    const activeInput = element.querySelector('input[data-attribute="active"]') as HTMLInputElement;
    const continueLink = findLink(element, "section", "Continue", true);

    // Fill only the active input (disabled one should be ignored)
    activeInput.value = "test";
    activeInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Link should be enabled (disabled input doesn't count)
    expect(continueLink.classList.contains("validation-disabled")).toBe(false);

    await squiffyApi.clickLink(continueLink);
    expect(element.querySelectorAll(".squiffy-output-section").length).toBe(2);
});

test("Input validation: select element with required attribute", async () => {
    const script = `
Choose difficulty: <select data-attribute="difficulty" required>
    <option value="">-- Select --</option>
    <option value="easy">Easy</option>
    <option value="normal">Normal</option>
    <option value="hard">Hard</option>
</select>

[[Start]]

[[Start]]:
You selected {{difficulty}} mode.
`;

    const { squiffyApi, element } = await initScript(script);

    const select = element.querySelector('select[data-attribute="difficulty"]') as HTMLSelectElement;
    const startLink = findLink(element, "section", "Start", true);

    // Initially link should be disabled because no option is selected
    expect(startLink.classList.contains("validation-disabled")).toBe(true);
    expect(startLink.getAttribute("aria-disabled")).toBe("true");

    // Try to click - should not navigate
    await squiffyApi.clickLink(startLink);
    expect(element.querySelectorAll(".squiffy-output-section").length).toBe(1);

    // Select an option
    select.value = "normal";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    // Link should now be enabled
    expect(startLink.classList.contains("validation-disabled")).toBe(false);
    expect(startLink.hasAttribute("aria-disabled")).toBe(false);

    // Click should work
    await squiffyApi.clickLink(startLink);
    expect(element.querySelectorAll(".squiffy-output-section").length).toBe(2);
    expect(getSectionContent(element, "Start")).toContain("You selected normal mode.");
});

test("Input validation: select element value is stored in attribute", async () => {
    const script = `
Choose difficulty: <select data-attribute="difficulty" required>
    <option value="">-- Select --</option>
    <option value="easy">Easy</option>
    <option value="normal">Normal</option>
    <option value="hard">Hard</option>
</select>

[[Start]]

[[Start]]:
Difficulty: {{difficulty}}
`;

    const { squiffyApi, element } = await initScript(script);

    const select = element.querySelector('select[data-attribute="difficulty"]') as HTMLSelectElement;
    const startLink = findLink(element, "section", "Start", true);

    // Select an option
    select.value = "hard";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    // Navigate
    await squiffyApi.clickLink(startLink);

    // Check that the value was stored correctly
    expect(squiffyApi.get("difficulty")).toBe("hard");
    expect(getSectionContent(element, "Start")).toContain("Difficulty: hard");
});

test("Input validation: changing select back to empty re-disables links", async () => {
    const script = `
Choose: <select data-attribute="choice" required>
    <option value="">-- Select --</option>
    <option value="a">Option A</option>
    <option value="b">Option B</option>
</select>

[[Continue]]

[[Continue]]:
Done!
`;

    const { squiffyApi, element } = await initScript(script);

    const select = element.querySelector('select[data-attribute="choice"]') as HTMLSelectElement;
    const continueLink = findLink(element, "section", "Continue", true);

    // Select an option
    select.value = "a";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    // Link should be enabled
    expect(continueLink.classList.contains("validation-disabled")).toBe(false);

    // Change back to empty
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    // Link should be disabled again
    expect(continueLink.classList.contains("validation-disabled")).toBe(true);

    // Try to click - should not navigate
    await squiffyApi.clickLink(continueLink);
    expect(element.querySelectorAll(".squiffy-output-section").length).toBe(1);
});

test("Input validation: select combined with other inputs", async () => {
    const script = `
Name: <input type="text" data-attribute="name" required>
Level: <select data-attribute="level" required>
    <option value="">-- Select --</option>
    <option value="1">Level 1</option>
    <option value="2">Level 2</option>
</select>

[[Continue]]

[[Continue]]:
{{name}} at level {{level}}
`;

    const { squiffyApi, element } = await initScript(script);

    const nameInput = element.querySelector('input[data-attribute="name"]') as HTMLInputElement;
    const levelSelect = element.querySelector('select[data-attribute="level"]') as HTMLSelectElement;
    const continueLink = findLink(element, "section", "Continue", true);

    // Initially disabled
    expect(continueLink.classList.contains("validation-disabled")).toBe(true);

    // Fill only name
    nameInput.value = "Player";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Still disabled because select is empty
    expect(continueLink.classList.contains("validation-disabled")).toBe(true);

    // Select level but clear name
    levelSelect.value = "1";
    levelSelect.dispatchEvent(new Event("change", { bubbles: true }));
    nameInput.value = "";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Still disabled because name is empty
    expect(continueLink.classList.contains("validation-disabled")).toBe(true);

    // Fill both
    nameInput.value = "Hero";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Now should be enabled
    expect(continueLink.classList.contains("validation-disabled")).toBe(false);

    // Click should work
    await squiffyApi.clickLink(continueLink);
    expect(getSectionContent(element, "Continue")).toContain("Hero at level 1");
});
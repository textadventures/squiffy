import { expect, test, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import globalJsdom from 'global-jsdom';
import { init } from './squiffy.runtime.js';
import { compile as squiffyCompile } from 'squiffy-compiler'; 

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
        scriptBaseFilename: "filename.squiffy", // TODO: This shouldn't be required
        script: script,
    });

    if (!compileResult.success) {
        throw new Error('Compile failed');
    }

    const story = compileResult.output.story;
    const js = compileResult.output.js.map(jsLines => new Function('squiffy', 'get', 'set', jsLines.join('\n')));

    return {
        story: {
            js: js as any,
            ...story,
        },
    };
}

const initScript = async (script: string) => {
    globalJsdom(html);
    const element = document.getElementById('squiffy');

    if (!element) {
        throw new Error('Element not found');
    }

    const compileResult = await compile(script);

    const squiffyApi = init({
        element: element,
        story: compileResult.story,
    });

    return {
        squiffyApi,
        element
    }
};

const findLink = (element: HTMLElement, linkType: string, linkText: string, onlyEnabled: boolean = false) => {
    const links = onlyEnabled
        ? element.querySelectorAll(`.squiffy-output-section:last-child a.squiffy-link.link-${linkType}`)
        : element.querySelectorAll(`a.squiffy-link.link-${linkType}`);
    return Array.from(links).find(link => link.textContent === linkText && (onlyEnabled ? !link.classList.contains("disabled") : true)) as HTMLElement;
};

const getTestOutput = () => {
    const testElement = document.getElementById('test');
    if (!testElement) {
        throw new Error('Test element not found');
    }
    return testElement.innerText;
}

let cleanup: { (): void };

beforeEach(() => {
    cleanup = globalJsdom();
});

afterEach(() => {
    cleanup();
});

test('"Hello world" script should run', async () => {
    const { element } = await initScript("Hello world");
    expect(element.innerHTML).toMatchSnapshot();
});

test('Click a section link', async () => {
    const script = await fs.readFile('../examples/test/example.squiffy', 'utf-8');
    const { squiffyApi, element } = await initScript(script);
    expect(element.innerHTML).toMatchSnapshot();

    expect(element.querySelectorAll('a.squiffy-link').length).toBe(10);
    const linkToPassage = findLink(element, 'passage', 'a link to a passage');
    const section3Link = findLink(element, 'section', 'section 3');

    expect(linkToPassage).not.toBeNull();
    expect(section3Link).not.toBeNull();
    expect(linkToPassage.classList).not.toContain('disabled');

    const handled = squiffyApi.clickLink(section3Link);
    expect(handled).toBe(true);

    expect(element.innerHTML).toMatchSnapshot();

    // passage link is from the previous section, so should be unclickable
    expect(squiffyApi.clickLink(linkToPassage)).toBe(false);
});

test('Click a passage link', async () => {
    const script = await fs.readFile('../examples/test/example.squiffy', 'utf-8');
    const { squiffyApi, element } = await initScript(script);
    expect(element.innerHTML).toMatchSnapshot();

    expect(element.querySelectorAll('a.squiffy-link').length).toBe(10);
    const linkToPassage = findLink(element, 'passage', 'a link to a passage');
    const section3Link = findLink(element, 'section', 'section 3');

    expect(linkToPassage).not.toBeNull();
    expect(section3Link).not.toBeNull();
    expect(linkToPassage.classList).not.toContain('disabled');

    const handled = squiffyApi.clickLink(linkToPassage);
    expect(handled).toBe(true);

    expect(linkToPassage.classList).toContain('disabled');
    expect(element.innerHTML).toMatchSnapshot();

    // shouldn't be able to click it again
    expect(squiffyApi.clickLink(linkToPassage)).toBe(false);
});

test('Run JavaScript functions', async () => {
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

    const clickContinue = () => {
        const continueLink = findLink(element, 'section', 'Continue...', true);
        expect(continueLink).not.toBeNull();
        const handled = squiffyApi.clickLink(continueLink);
        expect(handled).toBe(true);
    };

    const { squiffyApi, element } = await initScript(script);

    expect(getTestOutput()).toBe('Initial JavaScript');
    clickContinue();
    
    expect(getTestOutput()).toBe('Value: 5');
    clickContinue();

    expect(getTestOutput()).toBe('Value: some_value');
    clickContinue();

    expect(getTestOutput()).toBe('Value: 10');

    clickContinue();
    clickContinue();
    expect(getTestOutput()).toBe('Value: 11');

    clickContinue();
    expect(getTestOutput()).toBe('In other section');
});

function safeQuerySelector(name: string) {
    return name.replace(/'/g, "\\'");
}

function getSectionContent(element: HTMLElement, section: string) {
    return element.querySelector(`[data-source='[[${safeQuerySelector(section)}]]'] p`)?.textContent || null;
}

function getPassageContent(element: HTMLElement, section: string, passage: string) {
    return element.querySelector(`[data-source='[[${safeQuerySelector(section)}]][${safeQuerySelector(passage)}]'] p`)?.textContent || null;
}

test('Update default section output', async () => {
    const { squiffyApi, element } = await initScript("Hello world");
    let defaultOutput = getSectionContent(element, '_default');
    expect(defaultOutput).toBe('Hello world');
    expect(element.innerHTML).toMatchSnapshot();

    const updated = await compile("Updated content");
    squiffyApi.update(updated.story);
    defaultOutput = getSectionContent(element, '_default');
    expect(defaultOutput).toBe('Updated content');
    expect(element.innerHTML).toMatchSnapshot();
});

test.each(['a', 'a\'1'])('Update passage output - passage name "%s"', async (name) => {
    const { squiffyApi, element } = await initScript(`Click this: [${name}]

[${name}]:
Passage a content`);
    
    const link = findLink(element, 'passage', name);
    const handled = squiffyApi.clickLink(link);
    expect(handled).toBe(true);

    let defaultOutput = getSectionContent(element, '_default');
    expect(defaultOutput).toBe(`Click this: ${name}`);
    let passageOutput = getPassageContent(element, '_default', name);
    expect(passageOutput).toBe('Passage a content');
    expect(element.innerHTML).toMatchSnapshot();

    const updated = await compile(`Click this: [${name}]

[${name}]:
Updated passage content`);

    squiffyApi.update(updated.story);

    defaultOutput = getSectionContent(element, '_default');
    expect(defaultOutput).toBe(`Click this: ${name}`);

    passageOutput = getPassageContent(element, '_default', name);
    expect(passageOutput).toBe('Updated passage content');
    expect(element.innerHTML).toMatchSnapshot();
});

test('Delete section', async () => {
    const { squiffyApi, element } = await initScript(`Click this: [[a]]

[[a]]:
New section`);
    
    const link = findLink(element, 'section', 'a');
    const handled = squiffyApi.clickLink(link);
    expect(handled).toBe(true);

    let defaultOutput = getSectionContent(element, '_default');
    expect(defaultOutput).toBe('Click this: a');
    let sectionOutput = getSectionContent(element, 'a');
    expect(sectionOutput).toBe('New section');
    expect(element.innerHTML).toMatchSnapshot();

    const updated = await compile(`Click this: [[a]]`);

    squiffyApi.update(updated.story);

    defaultOutput = getSectionContent(element, '_default');
    expect(defaultOutput).toBe('Click this: a');
    sectionOutput = getSectionContent(element, 'a');
    expect(sectionOutput).toBeNull();

    expect(element.innerHTML).toMatchSnapshot();
});

test('Delete passage', async () => {
    const { squiffyApi, element } = await initScript(`Click this: [a]

[a]:
New passage`);
    
    const link = findLink(element, 'passage', 'a');
    const handled = squiffyApi.clickLink(link);
    expect(handled).toBe(true);

    let defaultOutput = getSectionContent(element, '_default');
    expect(defaultOutput).toBe('Click this: a');
    let passageOutput = getPassageContent(element, '_default', 'a');
    expect(passageOutput).toBe('New passage');
    expect(element.innerHTML).toMatchSnapshot();

    const updated = await compile(`Click this: [a]`);

    squiffyApi.update(updated.story);

    defaultOutput = getSectionContent(element, '_default');
    expect(defaultOutput).toBe('Click this: a');
    passageOutput = getPassageContent(element, '_default', 'a');
    expect(passageOutput).toBeNull();

    expect(element.innerHTML).toMatchSnapshot();
});

test('Clicked passage links remain disabled after an update', async () => {
    const { squiffyApi, element } = await initScript(`Click one of these: [a] [b]

[a]:
Output for passage A.

[b]:
Output for passage B.`);

    // click linkA
    
    let linkA = findLink(element, 'passage', 'a');
    expect(linkA.classList).not.toContain('disabled');
    expect(squiffyApi.clickLink(linkA)).toBe(true);

    const updated = await compile(`Click one of these (updated): [a] [b]

[a]:
Output for passage A.

[b]:
Output for passage B.`);

    squiffyApi.update(updated.story);

    // linkA should still be disabled

    linkA = findLink(element, 'passage', 'a');
    expect(linkA.classList).toContain('disabled');
    expect(squiffyApi.clickLink(linkA)).toBe(false);

    // linkB should still be enabled

    let linkB = findLink(element, 'passage', 'b');
    expect(linkB.classList).not.toContain('disabled');
    expect(squiffyApi.clickLink(linkB)).toBe(true);
});

test('Deleting the current section activates the previous section', async () => {
    const { squiffyApi, element } = await initScript(`Choose a section: [[a]] [[b]], or passage [start1].
    
[start1]:
Output for passage start1.

[[a]]:
Output for section A.

[[b]]:
Output for section B.`);

    // click linkA

    let linkA = findLink(element, 'section', 'a');
    let linkB = findLink(element, 'section', 'b');
    expect(linkA.classList).not.toContain('disabled');
    expect(squiffyApi.clickLink(linkA)).toBe(true);

    // can't click start1 passage as we're in section [[a]] now
    let linkStart1 = findLink(element, 'passage', 'start1');
    expect(squiffyApi.clickLink(linkStart1)).toBe(false);

    // can't click linkB as we're in section [[a]] now
    expect(squiffyApi.clickLink(linkB)).toBe(false);

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
    linkStart1 = findLink(element, 'passage', 'start1');
    expect(squiffyApi.clickLink(linkStart1)).toBe(true);

    // We're in the first section, so linkB should be clickable now
    linkB = findLink(element, 'section', 'b');
    expect(squiffyApi.clickLink(linkB)).toBe(true);

    // and the passage [b1] within it should be clickable
    const linkB1 = findLink(element, 'passage', 'b1');
    expect(squiffyApi.clickLink(linkB1)).toBe(true);
});
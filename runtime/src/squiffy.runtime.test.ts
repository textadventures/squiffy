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
    const links = element.querySelectorAll(`a.squiffy-link.link-${linkType}`);
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
    expect(section3Link.classList).not.toContain('disabled');

    squiffyApi.clickLink(section3Link);

    expect(linkToPassage.classList).toContain('disabled');
    expect(section3Link.classList).toContain('disabled');
    expect(element.innerHTML).toMatchSnapshot();
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
    expect(section3Link.classList).not.toContain('disabled');

    squiffyApi.clickLink(linkToPassage);

    expect(linkToPassage.classList).toContain('disabled');
    expect(section3Link.classList).not.toContain('disabled');
    expect(element.innerHTML).toMatchSnapshot();
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
        squiffyApi.clickLink(continueLink);
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

function getSectionContent(element: HTMLElement, section: string) {
    return element.querySelector(`[data-source='[[${section}]]'] p`)?.textContent || null;
}

function getPassageContent(element: HTMLElement, section: string, passage: string) {
    return element.querySelector(`[data-source='[[${section}]][${passage}]'] p`)?.textContent || null;
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

test('Update passage output', async () => {
    const { squiffyApi, element } = await initScript(`Click this: [a]

[a]:
Passage a content`);
    
    const link = findLink(element, 'passage', 'a');
    squiffyApi.clickLink(link);

    let defaultOutput = getSectionContent(element, '_default');
    expect(defaultOutput).toBe('Click this: a');
    let passageOutput = getPassageContent(element, '_default', 'a');
    expect(passageOutput).toBe('Passage a content');
    expect(element.innerHTML).toMatchSnapshot();

    const updated = await compile(`Click this: [a]

[a]:
Updated passage content`);

    squiffyApi.update(updated.story);

    defaultOutput = getSectionContent(element, '_default');
    expect(defaultOutput).toBe('Click this: a');

    passageOutput = getPassageContent(element, '_default', 'a');
    expect(passageOutput).toBe('Updated passage content');
    expect(element.innerHTML).toMatchSnapshot();
});

test('Delete section', async () => {
    const { squiffyApi, element } = await initScript(`Click this: [[a]]

[[a]]:
New section`);
    
    const link = findLink(element, 'section', 'a');
    squiffyApi.clickLink(link);

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
    squiffyApi.clickLink(link);

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
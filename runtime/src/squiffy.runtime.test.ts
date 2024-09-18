import { expect, test, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { JSDOM } from 'jsdom';
import globalJsdom from 'global-jsdom';
import { init } from './squiffy.runtime.js';
import { compile } from 'squiffy-compiler'; 

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

const initScript = async (script: string) => {
    const { window } = new JSDOM(html, { runScripts: "dangerously" });
    const document = window.document;
    const element = document.getElementById('squiffy');

    if (!element) {
        throw new Error('Element not found');
    }

    const compileResult = await compile({
        scriptBaseFilename: "filename.squiffy", // TODO: This shouldn't be required
        script: script,
    });

    if (!compileResult.success) {
        throw new Error('Compile failed');
    }

    const story = compileResult.output.story;
    const js = compileResult.output.js.map(jsLines => () => { eval(jsLines.join('\n')) });

    const squiffyApi = init({
        element: element,
        story: {
            js: js,
            ...story,
        },
    });

    return {
        squiffyApi,
        element
    }
};

const findLink = (element: HTMLElement, linkType: string, linkText: string) => {
    const links = element.querySelectorAll(`a.squiffy-link.link-${linkType}`);
    return Array.from(links).find(link => link.textContent === linkText) as HTMLElement;
};

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

    expect(linkToPassage).toBeDefined();
    expect(section3Link).toBeDefined();
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

    expect(linkToPassage).toBeDefined();
    expect(section3Link).toBeDefined();
    expect(linkToPassage.classList).not.toContain('disabled');
    expect(section3Link.classList).not.toContain('disabled');

    squiffyApi.clickLink(linkToPassage);

    expect(linkToPassage.classList).toContain('disabled');
    expect(section3Link.classList).not.toContain('disabled');
    expect(element.innerHTML).toMatchSnapshot();
});
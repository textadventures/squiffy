import { expect, test } from 'vitest';
import { JSDOM } from 'jsdom';
import 'global-jsdom/register';
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

const script = `
Hello world
`;

test('"Hello world" script should run', async () => {
    const { window } = new JSDOM(html);
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

    expect(element.innerHTML).toMatchSnapshot();
});
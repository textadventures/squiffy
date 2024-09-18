import { expect, test } from 'vitest'
import * as fs from 'fs';
import path from 'path';

import { compile, CompileSuccess } from './compiler.js';
import { externalFiles } from './external-files.js';

function assertSuccess(obj: unknown): asserts obj is CompileSuccess {
    if (!obj || typeof obj !== 'object' || !('success' in obj) || !obj.success) {
        throw new Error('Expected success');
    }
}

test('"Hello world" should compile', async () => {
    const result = await compile({
        scriptBaseFilename: "filename.squiffy",
        script: "hello world",
    });

    assertSuccess(result);
    expect(result.output.story.start).toBe("_default");
    expect(Object.keys(result.output.story.sections).length).toBe(1);
    expect(result.output.story.sections._default.text).toBe("<p>hello world</p>");
});

const examples = [
    "attributes/attributes.squiffy",
    "clearscreen/clearscreen.squiffy",
    "continue/continue.squiffy",
    "helloworld/helloworld.squiffy",
    "import/test.squiffy",
    "last/last.squiffy",
    "master/master.squiffy",
    "replace/replace.squiffy",
    "rotate/rotate.squiffy",
    "sectiontrack/sectiontrack.squiffy",
    "start/start.squiffy",
    "test/example.squiffy",
    "textprocessor/textprocessor.squiffy",
    "transitions/transitions.squiffy",
    "turncount/turncount.squiffy",
];

for (const example of examples) {
    test(example, async () => {
        const script = fs.readFileSync(`examples/${example}`, 'utf8');
        const filename = path.basename(example);
        const warnings: string[] = [];

        const result = await compile({
            scriptBaseFilename: filename,
            script: script,
            onWarning: (message) => {
                console.warn(message);
                warnings.push(message);
            },
            externalFiles: externalFiles(`examples/${example}`)
        });

        assertSuccess(result);
        expect(result.output).toMatchSnapshot();
        expect(warnings.length).toBe(0);
    });
}

const warningExamples = [
    "warnings/warnings.squiffy",
    "warnings/warnings2.squiffy",
];

for (const example of warningExamples) {
    test(example, async () => {
        const script = fs.readFileSync(`examples/${example}`, 'utf8');
        const filename = path.basename(example);

        const warnings: string[] = [];

        await compile({
            scriptBaseFilename: filename,
            script: script,
            onWarning: (message) => warnings.push(message)
        });
        
        expect(warnings).toMatchSnapshot();
    });
}
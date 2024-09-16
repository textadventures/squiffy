import { expect, test } from 'vitest'
import * as fs from 'fs';
import { Compiler } from './compiler.js';
import path from 'path';

test('"Hello world" should compile', async () => {
    const compiler = new Compiler({
        scriptBaseFilename: "filename.squiffy",
        script: "hello world",
    });
    await compiler.load();
    const result = await compiler.getStoryData();
    expect(result.story.start).toBe("_default");
    expect(Object.keys(result.story.sections).length).toBe(1);
    expect(result.story.sections._default.text).toBe("<p>hello world</p>");
});

const examples = [
    "attributes/attributes.squiffy",
    "clearscreen/clearscreen.squiffy",
    "continue/continue.squiffy",
    "helloworld/helloworld.squiffy",
    // TODO: import/test.squiffy - needs a way for us to provide imported files
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

        const compiler = new Compiler({
            scriptBaseFilename: filename,
            script: script,
        });
        await compiler.load();

        const result = await compiler.getStoryData();
        expect(result).toMatchSnapshot();
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

        const compiler = new Compiler({
            scriptBaseFilename: filename,
            script: script,
            onWarning: (message) => warnings.push(message)
        });
        
        await compiler.load();
        await compiler.getStoryData();
        expect(warnings).toMatchSnapshot();
    });
}
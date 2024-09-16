import { expect, test } from 'vitest'
import * as compiler from './compiler.js';
import * as fs from 'fs';

test('"Hello world" should compile', async () => {
    const result = await compiler.getStoryData('hello world');
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
    "warnings/warnings.squiffy",
    "warnings/warnings2.squiffy",
];

for (const example of examples) {
    test(example, async () => {
        const script = fs.readFileSync(`examples/${example}`, 'utf8');
        const result = await compiler.getStoryData(script);
        expect(result).toMatchSnapshot();
    });
}
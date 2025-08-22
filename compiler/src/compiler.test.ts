import { expect, test } from 'vitest'
import * as fs from 'fs/promises';
import { glob } from "glob";
import * as path from 'path';

import { compile, CompileSuccess } from './compiler.js';

const externalFiles = (inputFilename: string) => {
    const includedFiles = [path.resolve(inputFilename)];
    const basePath = path.resolve(path.dirname(inputFilename));
    return {
        getMatchingFilenames: async (pattern: string): Promise<string[]> => {
            const filenames = path.join(basePath, pattern);
            const result = await glob(filenames);
            return result.filter((filename: string) => !includedFiles.includes(filename));
        },
        getContent: async (filename: string): Promise<string> => {
            includedFiles.push(filename);
            return (await fs.readFile(filename)).toString();
        },
        getLocalFilename(filename: string): string {
            return path.relative(basePath, filename);
        }
    }
}

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
    expect(result.output.story.sections._default.text).toBe("hello world");
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
        const script = await fs.readFile(`../examples/${example}`, 'utf8');
        const filename = path.basename(example);
        const warnings: string[] = [];

        const result = await compile({
            scriptBaseFilename: filename,
            script: script,
            onWarning: (message) => {
                console.warn(message);
                warnings.push(message);
            },
            externalFiles: externalFiles(`../examples/${example}`)
        });

        assertSuccess(result);
        expect(await result.getJs(true)).toMatchSnapshot();
        expect(warnings.length).toBe(0);
    });
}

const warningExamples = [
    "warnings/warnings.squiffy",
    "warnings/warnings2.squiffy",
];

for (const example of warningExamples) {
    test(example, async () => {
        const script = await fs.readFile(`../examples/${example}`, 'utf8');
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
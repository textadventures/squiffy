import { expect, test } from "vitest";
import * as fs from "fs/promises";
import { glob } from "glob";
import * as path from "path";

import { compile, CompileSuccess } from "./compiler.js";

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
            // Resolve relative paths against basePath
            const resolvedPath = path.isAbsolute(filename) ? filename : path.join(basePath, filename);
            includedFiles.push(resolvedPath);
            return (await fs.readFile(resolvedPath)).toString();
        },
        getLocalFilename(filename: string): string {
            return path.relative(basePath, filename);
        }
    };
};

function assertSuccess(obj: unknown): asserts obj is CompileSuccess {
    if (!obj || typeof obj !== "object" || !("success" in obj) || !obj.success) {
        throw new Error("Expected success");
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

test("Blank game should compile", async () => {
    const result = await compile({
        scriptBaseFilename: "filename.squiffy",
        script: "",
    });

    assertSuccess(result);
    expect(result.output.story.start).toBe("_default");
    expect(Object.keys(result.output.story.sections).length).toBe(1);
    expect(result.output.story.sections._default.text).toBe("");
});

const examples = [
    "animate/animate.squiffy",
    "attributes/attributes.squiffy",
    "clearscreen/clearscreen.squiffy",
    "continue/continue.squiffy",
    "helloworld/helloworld.squiffy",
    "import/test.squiffy",
    "input/input.squiffy",
    "last/last.squiffy",
    "link-attributes/link-attributes.squiffy",
    "live/live.squiffy",
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
        const script = await fs.readFile(`../examples/${example}`, "utf8");
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
        const script = await fs.readFile(`../examples/${example}`, "utf8");
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

test("Error: passage without section", async () => {
    const script = `
[my passage]:
This is a passage without a section.
`;

    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("Can't add passage");
        expect(result.errors[0]).toContain("my passage");
        expect(result.errors[0]).toContain("no section has been created");
    }
});

test("Error: unexpected text in @ui block", async () => {
    const script = `
@ui
    console.log("valid js");
This text should not be here
---

Some content
`;

    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("Unexpected text in @ui block");
    }
});

test("Compiler stops at first error", async () => {
    const script = `
[passage1]:
No section for this passage

[passage2]:
Another orphaned passage
`;

    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
        // Compiler stops at first error, so only passage1 error is reported
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("passage1");
    }
});
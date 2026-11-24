import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { findStory } from "squiffy-compiler/node";
import { checkStory, formatCheckResult } from "./check.js";

let dir: string;

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "squiffy-check-"));
});

afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
});

const write = async (files: Record<string, string>) => {
    for (const [name, text] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
        await fs.writeFile(path.join(dir, name), text);
    }
};

const check = async (input = dir) => checkStory(await findStory(input), dir);

describe("checkStory", () => {
    test("finds broken links, dead ends and sections that can't be reached, with 1-based positions", async () => {
        await write({
            "squiffy.json": JSON.stringify({ version: 1, main: "story.squiffy" }),
            "story.squiffy": "Start. [[Cave]] [[Nowhere]]\n\n[[Cave]]:\nIt's dark.\n\n[[Secret]]:\n@end\nYou won.\n",
        });

        const result = await check();

        expect(result.success).toBe(true);
        expect(result.errorCount).toBe(0);
        expect(result.warningCount).toBe(3);
        expect(result.problems.map(p => [p.file, p.line, p.code])).toEqual([
            ["story.squiffy", 1, "squiffy/unknown-section-link"],
            ["story.squiffy", 3, "squiffy/dead-end"],
            ["story.squiffy", 6, "squiffy/unreachable-section"],
        ]);
        expect(result.problems[0].column).toBe(17);
        expect(result.story).toEqual({ start: "_default", sections: 3, passages: 0, endings: ["Secret"] });
    });

    test("checks every file in a project, and an error means it wouldn't build", async () => {
        await write({
            "squiffy.json": JSON.stringify({ version: 1, main: "story.squiffy" }),
            "story.squiffy": "Start. [[Shop]]\n",
            "parts/shop.squiffy": "[counter]:\nA passage before any section\n\n[[Shop]]:\n@end\nThe shop.\n",
        });

        const result = await check();

        expect(result.success).toBe(false);
        expect(result.errorCount).toBe(1);
        expect(result.problems[0]).toMatchObject({ file: "parts/shop.squiffy", line: 1, severity: "error", code: "squiffy/passage-without-section" });
    });

    test("a story without a squiffy.json is its main file and its imports", async () => {
        await write({
            "story.squiffy": "@import other.squiffy\nStart. [[Other]]\n",
            "other.squiffy": "[[Other]]:\n@end\nDone.\n",
            "unrelated.squiffy": "[[Unrelated]]:\nNever imported, so never checked. [[Missing]]\n",
        });

        const result = await check(path.join(dir, "story.squiffy"));

        expect(result.problems).toEqual([]);
        expect(result.story.sections).toBe(2);
        expect(formatCheckResult(result)).toBe('2 sections and 0 passages, starting at the text before the first section, with 1 ending: "Other".\nNo problems found.');
    });

    test("finds Handlebars template errors, which would otherwise only show when the story is played", async () => {
        await write({
            "squiffy.json": JSON.stringify({ version: 1, main: "story.squiffy" }),
            "story.squiffy": "[[start]]:\nThe words. \"Round {{round + 1}}, {{player_name}}\"\n[[Guess]](guess)\n\n" +
                "[[guess]]:\n@end\n{{#unless word}}No word.{{else if x}}X.{{/if}}\n",
        });

        const result = await check();

        expect(result.success).toBe(false);
        expect(result.errorCount).toBe(2);
        expect(formatCheckResult(result).split("\n").slice(0, 2)).toEqual([
            "story.squiffy:2:19: error: In section 'start', {{round + 1}} isn't valid Handlebars. To show the result of an expression, start it with \"=\": {{= round + 1}} [squiffy/template-syntax]",
            "story.squiffy:7:1: error: In section 'guess', {{#unless word}} is closed by {{/if}}, but it needs a {{/unless}} [squiffy/template-syntax]",
        ]);
    });

    test("formats problems with file:line:column", async () => {
        await write({
            "squiffy.json": JSON.stringify({ version: 1, main: "story.squiffy" }),
            "story.squiffy": "Start. [[Missing]]\n",
        });

        expect(formatCheckResult(await check())).toBe(
            "story.squiffy:1:8: warning: In the text before the first section there is a link to a section called [[Missing]], which doesn't exist [squiffy/unknown-section-link]\n" +
            "\n" +
            "1 section and 0 passages, starting at the text before the first section, with no sections marked @end.\n" +
            "0 errors, 1 warning.");
    });
});

// The example stories in the repo's examples/ folder, which the docs site builds and shows on its
// Examples page: each should have no problems, play at random without any, and pass its own
// playthrough tests.
import { describe, expect, test } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { findStory } from "squiffy-compiler/node";
import { checkStory } from "./check.js";
import { loadPlayableStory, playRandom } from "./play.js";
import { findTestFiles, parseTest, runTest } from "./playtest.js";

const examplesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../examples");
const examples = fs.readdirSync(examplesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(examplesDir, entry.name, "squiffy.json")))
    .map(entry => entry.name);

test("there are examples", () => {
    expect(examples).toEqual(expect.arrayContaining(["coffeeshop", "gameshow"]));
});

describe.each(examples)("%s", name => {
    const dir = path.join(examplesDir, name);

    test("has no problems", async () => {
        const result = await checkStory(await findStory(dir), dir);
        expect(result.problems).toEqual([]);
    });

    test("plays at random with no problems, reaching every section", async () => {
        const loaded = await loadPlayableStory(await findStory(dir));
        if (!loaded.success) throw new Error(loaded.errors.join("\n"));
        const result = await playRandom(loaded.playable, { runs: 50, steps: 200, seed: 1 });
        expect(result.problems).toEqual([]);
        expect(result.sections.notVisited).toEqual([]);
    }, 60000);

    test("passes its playthrough tests", async () => {
        const loaded = await loadPlayableStory(await findStory(dir));
        if (!loaded.success) throw new Error(loaded.errors.join("\n"));
        const files = findTestFiles(dir, dir);
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            const outcome = await runTest(loaded.playable, parseTest(fs.readFileSync(file, "utf8")));
            expect(outcome, path.relative(dir, file)).toMatchObject({ passed: true });
        }
    }, 60000);
});

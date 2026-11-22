import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { findStory } from "squiffy-compiler/node";
import { loadPlayableStory, playStory, type PlayableStory } from "./play.js";
import {
    findTestFiles, formatTest, formatTestResults, parseTest, runTest, testFromResult, TestFileError, type PlaythroughTest,
} from "./playtest.js";

let dir: string;

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "squiffy-playtest-"));
});

afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
});

async function load(script: string): Promise<PlayableStory> {
    await fs.writeFile(path.join(dir, "squiffy.json"), JSON.stringify({ version: 1, main: "story.squiffy" }));
    await fs.writeFile(path.join(dir, "story.squiffy"), script);
    const loaded = await loadPlayableStory(await findStory(dir));
    if (!loaded.success) throw new Error(loaded.errors.join("\n"));
    return loaded.playable;
}

const SHOP = `@set gold = 10
@set name = "nobody"
You're outside a shop. [[Go in]](shop) or [look around].

[look around]:
@set looked = true
There's a sign on the door.

[[shop]]:
@set gold -= 3
"Welcome!" [[Leave]](street)

[[street]]:
@end
You walk off down the street.`;

async function record(playable: PlayableStory, choose: string[], options: { seed?: number; inputs?: Record<string, string>; ignore?: string[] } = {}) {
    const seed = options.seed ?? 1;
    const result = await playStory(playable, { choose, seed, inputs: options.inputs, stepAttributes: true });
    expect(result.success).toBe(true);
    return testFromResult(result, { seed, inputs: options.inputs, ignore: options.ignore });
}

describe("recording", () => {
    test("records where each link went and what it changed", async () => {
        const recorded = await record(await load(SHOP), ["look around", "Go in", "Leave"]);

        expect(recorded.steps).toEqual([
            { went: [{ section: "_default" }], set: { gold: 10, name: "nobody" }, unset: [] },
            { choice: "look around", went: [{ section: "_default", passage: "look around" }], set: { looked: true }, unset: [] },
            { choice: "Go in", went: [{ section: "shop" }], set: { gold: 7 }, unset: [] },
            { choice: "Leave", went: [{ section: "street" }], set: {}, unset: [] },
        ]);
        expect(formatTest(recorded)).toBe(`# A playthrough of the story, recorded with --play --record.
# Run it with --test, or record it again with --test --update.
seed 1

went "_default"
set gold = 10
set name = "nobody"

> look around
went "_default" "look around"
set looked = true

> Go in
went "shop"
set gold = 7

> Leave
went "street"
`);
    });

    test("reads back what it writes", async () => {
        const written: PlaythroughTest = {
            comments: [" My test", ""],
            seed: -5,
            start: "a \"quoted\" section",
            inputs: { name: "Sam = me" },
            ignore: ["told", "seen_*", "odd *name"],
            steps: [
                { went: [{ section: "a \"quoted\" section" }], set: { "odd name": [1, { x: "y" }], plain: null }, unset: [] },
                { choice: "Next >", went: [{ section: "b", passage: "c d" }], set: {}, unset: ["plain", "odd name"] },
            ],
        };
        expect(parseTest(formatTest(written))).toEqual(written);
    });

    test("says what's wrong with a test file", () => {
        expect(() => parseTest("went \"a\"")).toThrow(new TestFileError("There's no seed line."));
        expect(() => parseTest("seed 1\nwent a")).toThrow(/Line 2: expected some text in double quotes/);
        expect(() => parseTest("seed 1\nset gold = ten")).toThrow(/Line 2: the value of gold should be JSON/);
        expect(() => parseTest("seed 1\n\n> Go\nseed 2")).toThrow(/Line 4: expected "> ", "went", "set" or "unset", not "seed"/);
        expect(() => parseTest("seed 1\nfoo")).toThrow(/Line 2: expected "seed"/);
        expect(() => parseTest("seed 1\nignore")).toThrow(/Line 2: expected the attributes to ignore/);
        expect(() => parseTest("seed 1\nignore gold = 1")).toThrow(/Line 2: expected attribute names/);
        expect(() => parseTest("seed 1\n\n> Go\nignore gold")).toThrow(/Line 4: expected "> ", "went", "set" or "unset", not "ignore"/);
    });

    test("leaves out the attributes it ignores", async () => {
        const recorded = await record(await load(SHOP), ["look around", "Go in"], { ignore: ["gold", "lo*ed"] });

        expect(recorded.steps.map(step => step.set)).toEqual([{ name: "nobody" }, {}, {}]);
        expect(formatTest(recorded)).toContain("seed 1\nignore gold lo*ed\n");
        expect(parseTest(formatTest(recorded))).toEqual(recorded);

    });
});

describe("replaying", () => {
    test("passes when the story plays the same way", async () => {
        const playable = await load(SHOP);
        const recorded = await record(playable, ["look around", "Go in", "Leave"]);

        expect(await runTest(playable, parseTest(formatTest(recorded)))).toEqual({ passed: true, differences: [] });
    });

    test("reports the first step that went differently, with what happened instead", async () => {
        const recorded = await record(await load(SHOP), ["look around", "Go in", "Leave"]);
        const changed = await load(SHOP.replace("@set gold -= 3", "@set gold -= 4\n@set name = \"Sam\"").replace("[[Leave]](street)", "[[Leave]](road)\n\n[[road]]:\n@end"));

        const outcome = await runTest(changed, recorded);

        expect(outcome).toMatchObject({
            passed: false,
            step: 3,
            choice: "Go in",
            differences: ["gold was set to 6, but expected set to 7.", "name was set to \"Sam\", but expected not changed."],
        });
        // What happened instead, to record with --update
        expect(outcome.actual!.steps[3].went).toEqual([{ section: "road" }]);
        expect(outcome.actual!.comments).toEqual(recorded.comments);
    });

    test("reports a different section, and a link that isn't there any more", async () => {
        const recorded = await record(await load(SHOP), ["Go in", "Leave"]);

        const moved = await runTest(await load(SHOP.replace("[[Go in]](shop)", "[[Go in]](street)")), recorded);
        expect(moved).toMatchObject({
            passed: false, step: 2, choice: "Go in",
            differences: ["Went to section \"street\", but expected section \"shop\".", "gold was not changed, but expected set to 7."],
        });

        const gone = await runTest(await load(SHOP.replace("[[Go in]](shop)", "[[Enter]](shop)")), recorded);
        expect(gone).toMatchObject({
            passed: false, step: 2, choice: "Go in",
            differences: ["There's no link \"Go in\" to click. The links are: \"Enter\", \"look around\"."],
        });
        // Play stopped, so there's nothing to record again
        expect(gone.actual).toBeUndefined();
    });

    test("fails on an error in the story, with nothing to record again", async () => {
        const recorded = await record(await load(SHOP), ["Go in"]);
        const outcome = await runTest(await load(SHOP.replace("@set gold -= 3", "@set gold -= 3\n    squiffy.set(\"x\", notDefined.y);")), recorded);

        expect(outcome.passed).toBe(false);
        expect(outcome.step).toBe(2);
        expect(outcome.differences.some(d => d.startsWith("Error: "))).toBe(true);
        expect(outcome.actual).toBeUndefined();
    });

    test("plays with the recorded seed and text box values", async () => {
        const playable = await load(`    squiffy.set("roll", Math.floor(Math.random() * 1000000));
<input type="text" data-attribute="name">
[[Go]](next)

[[next]]:
Hello {{name}}.`);
        const recorded = await record(playable, ["Go"], { seed: 42, inputs: { name: "Sam" } });
        expect(recorded.steps[1].set).toMatchObject({ name: "Sam" });

        expect((await runTest(playable, recorded)).passed).toBe(true);
        expect((await runTest(playable, { ...recorded, seed: 43 })).differences[0]).toMatch(/^roll was set to/);
    });

    test("doesn't compare the attributes it ignores", async () => {
        const changed = await load(SHOP.replace("@set gold -= 3", "@set gold -= 4\n@set name = \"Sam\""));

        // Recorded with the ignore line, so the attributes aren't in the test, and --update keeps it
        const ignoring = await record(await load(SHOP), ["Go in"], { ignore: ["gold"] });
        const outcome = await runTest(changed, ignoring);
        expect(outcome).toMatchObject({ passed: false, step: 2, differences: ["name was set to \"Sam\", but expected not changed."] });
        expect(outcome.actual!.ignore).toEqual(["gold"]);
        expect(outcome.actual!.steps.flatMap(step => Object.keys(step.set))).not.toContain("gold");

        // An ignore line added by hand to a test recorded without it
        const recorded = await record(await load(SHOP), ["Go in"]);
        expect((await runTest(changed, { ...recorded, ignore: ["gold"] })).differences).toEqual(["name was set to \"Sam\", but expected not changed."]);
        expect((await runTest(changed, { ...recorded, ignore: ["*"] })).passed).toBe(true);
    });

    test("leaves out attributes the runtime sets on every click", async () => {
        const recorded = await record(await load(SHOP), ["Go in", "Leave"]);
        const names = recorded.steps.flatMap(step => Object.keys(step.set));
        expect(names).not.toContain("turns");
        expect(names).not.toContain("previous");
        expect(names).not.toContain("previous_section");
    });
});

describe("finding and reporting tests", () => {
    test("finds test files in the folder, apart from the build folder and hidden folders", async () => {
        for (const file of ["tests/a.squiffy-test", "b.squiffy-test", "build/c.squiffy-test", ".hidden/d.squiffy-test", "node_modules/e.squiffy-test", "tests/notes.txt"]) {
            await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
            await fs.writeFile(path.join(dir, file), "");
        }
        expect(findTestFiles(dir, dir).map(f => path.relative(dir, f))).toEqual(["b.squiffy-test", path.join("tests", "a.squiffy-test")]);
        expect(findTestFiles(path.join(dir, "tests"), dir).map(f => path.relative(dir, f))).toEqual([path.join("tests", "a.squiffy-test")]);
        expect(findTestFiles(path.join(dir, "build/c.squiffy-test"), dir)).toEqual([path.join(dir, "build/c.squiffy-test")]);
    });

    test("says which passed, which failed and where", () => {
        expect(formatTestResults([
            { file: "tests/a.squiffy-test", passed: true, differences: [] },
            { file: "tests/b.squiffy-test", passed: false, step: 2, choice: "Go in", differences: ["gold was set to 6, but expected set to 7."] },
            { file: "tests/c.squiffy-test", passed: false, step: 1, differences: ["Went to section \"a\", but expected section \"b\"."], updated: true },
        ])).toBe(`PASS tests/a.squiffy-test
FAIL tests/b.squiffy-test
  At step 2 (> Go in):
    gold was set to 6, but expected set to 7.
UPDATED tests/c.squiffy-test
  At step 1 (the start of the story):
    Went to section "a", but expected section "b".

3 tests: 1 passed, 1 failed, 1 recorded again.`);
    });
});

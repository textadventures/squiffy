import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { findStory } from "squiffy-compiler/node";
import {
    formatChoicesFile, formatPlayResult, formatRandomResult, loadPlayableStory, parseChoicesFile, playRandom, playStory, reproduceOptions,
    type PlayableStory,
} from "./play.js";

let dir: string;

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "squiffy-play-"));
});

afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
});

// A story with a squiffy.json, so setters take expressions, as in a new Squiffy 7 story
async function load(script: string): Promise<PlayableStory> {
    await fs.writeFile(path.join(dir, "squiffy.json"), JSON.stringify({ version: 1, main: "story.squiffy" }));
    await fs.writeFile(path.join(dir, "story.squiffy"), script);
    const loaded = await loadPlayableStory(await findStory(dir));
    if (!loaded.success) throw new Error(loaded.errors.join("\n"));
    return loaded.playable;
}

const SHOP = `@set gold = 10
You're outside a shop. You have {{gold}} gold. [[Go in]](shop) or [look around].

[look around]:
There's a sign on the door.

[[shop]]:
@set gold -= 3
"Welcome!" You have {{gold}} gold left. [[Leave]](street)

[[street]]:
@end
You walk off down the street.`;

describe("playStory", () => {
    test("shows the text, the links to click and where they go", async () => {
        const result = await playStory(await load(SHOP));

        expect(result.success).toBe(true);
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0].text).toBe("You're outside a shop. You have 10 gold. [Go in] or [look around].");
        expect(result.steps[0].went).toEqual([{ section: "_default" }]);
        expect(result.section).toBe("_default");
        expect(result.choices).toEqual([
            { number: 1, text: "Go in", section: "shop" },
            { number: 2, text: "look around", passage: "look around" },
        ]);
        expect(result.attributes).toMatchObject({ gold: 10 });
        expect(result.ending).toBe(false);
    });

    test("clicks links by their text or number, in order, to an ending", async () => {
        const result = await playStory(await load(SHOP), { choose: ["LOOK AROUND", "1", "Leave"] });

        expect(result.success).toBe(true);
        expect(result.steps.map(s => [s.choice, s.text])).toEqual([
            [undefined, "You're outside a shop. You have 10 gold. [Go in] or [look around]."],
            ["look around", "There's a sign on the door."],
            ["Go in", "\"Welcome!\" You have 7 gold left. [Leave]"],
            ["Leave", "You walk off down the street."],
        ]);
        expect(result.steps[1].went).toEqual([{ section: "_default", passage: "look around" }]);
        expect(result.section).toBe("street");
        expect(result.ending).toBe(true);
        expect(result.choices).toEqual([]);
        const text = formatPlayResult(result, true);
        expect(text).toContain("> Leave\n(section \"street\")\n\nYou walk off down the street.\n\nThe end: section \"street\" is one of the story's endings.");
        expect(text).toContain("Attributes:\n  turns = 3\n  gold = 7\n");
    });

    test("stops at a link that isn't there, saying what the links are", async () => {
        const result = await playStory(await load(SHOP), { choose: ["Go in", "Go in"] });

        expect(result.success).toBe(false);
        expect(result.steps).toHaveLength(2);
        expect(result.stopped).toBe("There's no link \"Go in\" to click. The links are: \"Leave\".");
    });

    test("carries on from a saved game", async () => {
        const playable = await load(SHOP);
        const first = await playStory(playable, { choose: ["Go in"] });
        const second = await playStory(playable, { save: first.save, choose: ["Leave"] });

        expect(second.steps[0].text).toBe("\"Welcome!\" You have 7 gold left. [Leave]");
        expect(second.steps[1].text).toBe("You walk off down the street.");
        expect(second.ending).toBe(true);
    });

    test("starts at another section", async () => {
        const result = await playStory(await load(SHOP), { start: "shop" });
        expect(result.steps[0].text).toBe("\"Welcome!\" You have -3 gold left. [Leave]");

        const missing = await playStory(await load(SHOP), { start: "nowhere" });
        expect(missing.stopped).toBe("There's no section called \"nowhere\".");
    });

    test("fills in text boxes, without which links that need them can't be clicked", async () => {
        const playable = await load(`What's your name? <input type="text" data-attribute="name" required>

[[Start]]

[[Start]]:
Hello, {{name}}!`);

        const empty = await playStory(playable, { choose: ["Start"] });
        expect(empty.steps[0].text).toBe("What's your name? [text box for name]\n\n[Start]");
        expect(empty.choices).toEqual([{ number: 1, text: "Start", section: "Start", needsInput: true }]);
        expect(empty.stopped).toMatch(/can't be clicked until the text boxes are filled in/);

        const filled = await playStory(playable, { inputs: { name: "Robin" }, choose: ["Start"] });
        expect(filled.success).toBe(true);
        expect(filled.steps[1].text).toBe("Hello, Robin!");
    });

    test("reports errors from the story, and links to sections that don't exist", async () => {
        const playable = await load(`[[Script]] [[Missing]]

[[Script]]:
    squiffy.set("x", notDefined.y);
Never shown.`);

        const script = await playStory(playable, { choose: ["Script"] });
        expect(script.success).toBe(false);
        expect(script.steps[1].errors).toEqual(["notDefined is not defined"]);
        expect(formatPlayResult(script, false)).toContain("ERROR: notDefined is not defined");

        const missing = await playStory(playable, { choose: ["Missing"] });
        expect(missing.steps[1].errors).toEqual(["There's no section called \"Missing\", so the link \"Missing\" does nothing."]);
    });

    test("time passes at once, and a story that keeps moving on by itself is stopped", async () => {
        const playable = await load(`[[Wait]] [[Clock]]

[[Wait]]:
Waiting... {{goto "Later" after=60000}}

[[Later]]:
@end
A minute later.

[[Clock]]:
Tick. {{goto "Clock" after=1000}}`);

        const wait = await playStory(playable, { choose: ["Wait"] });
        expect(wait.steps[1].text).toBe("Waiting...\n\nA minute later.");
        expect(wait.steps[1].went).toEqual([{ section: "Wait" }, { section: "Later" }]);
        expect(wait.ending).toBe(true);

        const clock = await playStory(playable, { choose: ["Clock"] });
        expect(clock.steps[1].stillGoing).toBe(true);
        expect(formatPlayResult(clock, false)).toContain(`(section "Clock" ${clock.steps[1].went.length} times)`);
    });

    test("animations finish at once, and continue text is clicked like a link", async () => {
        const playable = await load(`{{#label "status"}}Waiting{{/label}} [Go]

[Go]:
{{#replace "status"}}Done{{/replace}}
{{#animate "toast"}}Correct!{{/animate}}

{{#animate "continue"}}Carry on{{/animate}}

[[Next]]

[[Next]]:
@end
Finished.`);

        const result = await playStory(playable, { choose: ["Go", "Carry on", "Next"] });

        expect(result.success).toBe(true);
        expect(result.steps[1].text).toBe("Correct!\n\n[Carry on]\n\nNext");
        expect(result.steps[2].choice).toBe("Carry on");
        expect(result.steps[3].text).toBe("Finished.");
        expect(result.ending).toBe(true);
    });

    test("says what a link that changes when it's clicked now says", async () => {
        const playable = await load("Your answer: {{rotate (array \"Paris\" \"London\") set=\"answer\"}}");

        const result = await playStory(playable, { choose: ["Paris"] });

        expect(result.steps[1].text).toBe("(The link now says \"London\".)");
        expect(result.attributes.answer).toBe("London");
    });

    test("a seed makes the story's randomness the same every time", async () => {
        const playable = await load("{{random (array \"a\" \"b\" \"c\" \"d\" \"e\" \"f\" \"g\" \"h\")}}{{random (array \"a\" \"b\" \"c\" \"d\" \"e\" \"f\" \"g\" \"h\")}}{{random (array \"a\" \"b\" \"c\" \"d\" \"e\" \"f\" \"g\" \"h\")}}");

        const first = await playStory(playable, { seed: 42 });
        const second = await playStory(playable, { seed: 42 });

        expect(first.steps[0].text).toMatch(/^[a-h]{3}$/);
        expect(second.steps[0].text).toBe(first.steps[0].text);
    });
});

describe("playRandom", () => {
    const MAZE = `[[Left]] [[Right]] [[Broken]]

[[Left]]:
[[Treasure]] [[Pit]]

[[Right]]:
A dead end.

[[Broken]]:
    squiffy.set("x", notDefined.y);

[[Treasure]]:
@end
You found the treasure.

[[Pit]]:
@end
You fell in a pit.

[[Unused]]:
@end
Nothing links here.`;

    test("reports errors, dead ends, endings and sections never visited", async () => {
        const result = await playRandom(await load(MAZE), { runs: 30, steps: 50, seed: 1 });

        expect(result.success).toBe(false);
        expect(result.problems.map(p => [p.kind, p.section])).toEqual(expect.arrayContaining([
            ["error", "Broken"],
            ["dead-end", "Right"],
        ]));
        expect(result.problems[0].kind).toBe("error");
        expect(Object.keys(result.endings).sort()).toEqual(["Pit", "Treasure"]);
        expect(result.sections.notVisited).toEqual(["Unused"]);
        expect(result.sections.total).toBe(7);

        const text = formatRandomResult(result);
        expect(text).toContain("Played 30 times, clicking up to 50 links at random each time (--seed 1).");
        expect(text).toContain("Never visited: \"Unused\"");
        expect(text).toContain("To get there: --play --seed");
    });

    test("gives the options that play the story back to each problem", async () => {
        const playable = await load(MAZE);
        const result = await playRandom(playable, { runs: 30, steps: 50, seed: 1 });

        for (const problem of result.problems) {
            const replay = await playStory(playable, { seed: problem.seed, choose: problem.choices });
            expect(replay.section).toBe(problem.section);
            if (problem.kind == "error") {
                expect(replay.steps[replay.steps.length - 1].errors).toContain(problem.message);
            }
        }
        expect(reproduceOptions({ seed: 5, inputs: [{ attribute: "name", value: "Sam" }], choices: ["Go in", "Bob's"] }))
            .toBe("--play --seed 5 --input name=Sam --choose 'Go in' --choose 'Bob'\\''s'");
    });

    test("gives a long way to a problem as a choices file", async () => {
        const problem = { seed: 5, inputs: [], choices: ["Go in", "# 1 fan", "2"] };
        expect(reproduceOptions(problem, "shop", "build/random/problem-1.txt"))
            .toBe("--play --seed 5 --start shop --choices build/random/problem-1.txt");

        const file = formatChoicesFile(problem.choices, ["Dead end in section \"x\""]);
        expect(file).toBe("# Dead end in section \"x\"\nGo in\n# 1 fan\n2\n");
        // "# " starts a comment (--random gives a link starting with "#" by its number instead)
        expect(parseChoicesFile(file)).toEqual(["Go in", "2"]);
        expect(parseChoicesFile("#1 fan\r\n\n  Leave  \n#\n")).toEqual(["#1 fan", "Leave"]);
    });

    test("fills in text boxes so links that need them can be clicked", async () => {
        const playable = await load(`Name: <input type="text" data-attribute="name" required minlength="5">

[[Start]]

[[Start]]:
@end
Hello, {{name}}!`);

        const result = await playRandom(playable, { runs: 2, steps: 10, seed: 1 });

        expect(result.problems).toEqual([]);
        expect(result.endings).toEqual({ Start: 2 });
    });
});

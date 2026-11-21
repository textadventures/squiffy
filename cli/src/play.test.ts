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

    // A story whose helpers come from @ui, as an agent plays it: a step at a time, from a save
    const HELPERS = `@ui
    squiffy.registerHelper("shout", (text) => text.toUpperCase() + "!");
---

{{shout "one"}} [[Go on]](next)

[[next]]:
{{shout "two"}} [[Finish]](last)

[[last]]:
@end
{{#if (shout "x")}}{{shout "three"}}{{/if}}`;

    test("runs @ui before carrying on from a saved game", async () => {
        const playable = await load(HELPERS);
        const first = await playStory(playable, { choose: ["Go on"] });
        expect(first.steps[1].text).toBe("TWO! [Finish]");

        const second = await playStory(playable, { save: first.save, choose: ["Finish"] });
        expect(second.steps[1].text).toBe("THREE!");
        expect(second.steps[1].errors).toEqual([]);
    });

    test("runs @ui before starting at another section", async () => {
        const result = await playStory(await load(HELPERS), { start: "next", choose: ["Finish"] });
        expect(result.steps.map(step => step.text)).toEqual(["TWO! [Finish]", "THREE!"]);
        expect(result.steps.flatMap(step => step.errors)).toEqual([]);
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

    test("presses Enter in a text box that goes somewhere (#454)", async () => {
        const playable = await load(`What's your name? <input type="text" data-attribute="hero.name" data-section="greet" required>

[[greet]]:
Hello, {{hero.name}}! <input data-attribute="guess" data-passage="check">

[check]:
@repeat
You guessed {{guess}}.`);

        const empty = await playStory(playable);
        expect(empty.steps[0].text).toBe("What's your name? [text box for hero.name, Enter to go on]");
        expect(empty.choices).toEqual([{ number: 1, text: "Press Enter in the text box for hero.name", section: "greet", needsInput: true }]);
        const stopped = await playStory(playable, { choose: ["1"] });
        expect(stopped.stopped).toMatch(/can't be clicked until the text boxes are filled in/);

        const result = await playStory(playable, { inputs: { "hero.name": "Robin", guess: "7" }, choose: ["1", "Press Enter in the text box for guess", "1"] });
        expect(result.success).toBe(true);
        expect(result.steps[1].text).toBe("Hello, Robin! [text box for guess, Enter to go on]");
        expect(result.steps[2].text).toBe("You guessed 7.");
        expect(result.steps[3].text).toBe("You guessed 7.");
        expect(result.attributes).toMatchObject({ hero: { name: "Robin" }, guess: "7" });
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

    test("{{#every}} text that never stops isn't a story stuck moving on (#451)", async () => {
        const playable = await load(`@set n = 0
The clock says {{#every 1000}}{{inc "n"}}{{n}}{{/every}}. [[Fuse]]

[[Fuse]]:
@set fuse = 3
{{#every "1s"}}{{dec "fuse"}}{{fuse}}...{{#if fuse <= 0}}{{stop}}{{goto "Boom"}}{{/if}}{{/every}}

[[Boom]]:
@end
BOOM.`);

        const result = await playStory(playable, { choose: ["Fuse"] });
        expect(result.steps[0].repeating).toBe(true);
        expect(result.steps[0].stillGoing).toBeUndefined();
        expect(result.steps[0].text).toBe("The clock says 20. [Fuse]");
        expect(formatPlayResult(result, false)).toContain("with {{#every}}, so play stopped waiting for it here");
        expect(result.steps[1].text).toBe("0...\n\nBOOM.");
        expect(result.steps[1].repeating).toBeUndefined();
        expect(result.ending).toBe(true);
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

    test("calls a section without a name of its own by its +++ or --- line, and the named section before it", async () => {
        const playable = await load("[[cave]]:\nA cave.\n+++Continue...\nDark.\n+++Continue...\nStuck here. [look]\n\n[look]:\nNothing.\n\n---\nNever reached.");
        const played = await playStory(playable, { choose: ["Continue...", "Continue..."] });
        expect(played.sectionLabels).toEqual({
            _continue1: "the first \"+++Continue...\" after \"cave\"",
            _continue2: "the second \"+++Continue...\" after \"cave\"",
        });
        const playText = formatPlayResult(played, false);
        expect(playText).toContain("(the second \"+++Continue...\" after \"cave\")");
        expect(playText).toContain("Choices (in the second \"+++Continue...\" after \"cave\"):");
        expect(playText).not.toContain("_continue");

        const random = await playRandom(playable, { runs: 5, steps: 20, seed: 1 });
        const randomText = formatRandomResult(random);
        expect(randomText).toContain("Never visited: the \"---\" after \"cave\"");
        expect(randomText).toContain("Dead end in the second \"+++Continue...\" after \"cave\"");
        expect(randomText).not.toContain("_continue");
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

    test("leaves out {{restart}}, {{saves}} and {{settings}} links, which aren't choices", async () => {
        const playable = await load(`Take a break: {{saves}} {{settings}} [[Go on]](end)

[[end]]:
@end
The end. {{restart text="Play again"}}`);

        expect((await playStory(playable)).choices).toEqual([{ number: 1, text: "Go on", section: "end" }]);
        const result = await playRandom(playable, { runs: 2, steps: 10, seed: 1 });
        expect(result.problems).toEqual([]);
        expect(result.endings).toEqual({ end: 2 });
    });

    test("doesn't count a panel's passage as never visited", async () => {
        await fs.writeFile(path.join(dir, "squiffy.json"), JSON.stringify({
            version: 1, main: "story.squiffy", panels: [{ passage: "status", label: "Status" }],
        }));
        await fs.writeFile(path.join(dir, "story.squiffy"), `[[]]:

[status]:
Fine.

[[start]]:
@end
The end.`);
        const loaded = await loadPlayableStory(await findStory(dir));
        if (!loaded.success) throw new Error(loaded.errors.join("\n"));

        const result = await playRandom(loaded.playable, { runs: 1, steps: 10, seed: 1 });
        expect(result.passages).toEqual({ total: 0, visited: 0, notVisited: [] });
    });

    test("counts a master section's passage as visited when it's shown from another section", async () => {
        const playable = await load(`[[start]]:
@end
[Wait](stare) or [look].

[look]:
You look.

[[]]:

[stare]:
You stare.

[never]:
Not linked to.`);

        const result = await playRandom(playable, { runs: 3, steps: 10, seed: 1 });
        expect(result.passages).toEqual({ total: 3, visited: 2, notVisited: ["/never"] });
    });

    test("presses Enter in text boxes that go somewhere (#454)", async () => {
        const playable = await load(`Name: <input type="text" data-attribute="name" data-section="Start" required minlength="5">

[[Start]]:
@end
Hello, {{name}}!`);

        const result = await playRandom(playable, { runs: 2, steps: 10, seed: 1 });

        expect(result.problems).toEqual([]);
        expect(result.endings).toEqual({ Start: 2 });
    });
});

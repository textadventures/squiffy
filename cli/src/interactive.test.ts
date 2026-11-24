import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { findStory } from "squiffy-compiler/node";
import { loadPlayableStory, playStory, type PlayableStory, type PlayResult } from "./play.js";
import { playInteractive, type InteractiveOptions } from "./interactive.js";

let dir: string;

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "squiffy-interactive-"));
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

async function* linesOf(lines: string[]) {
    for (const line of lines) yield line;
}

// Plays with --json, and returns each line written, parsed
async function play(playable: PlayableStory, lines: string[], options: InteractiveOptions = {}) {
    let output = "";
    const saves: PlayResult[] = [];
    const result = await playInteractive(playable, { json: true, ...options }, linesOf(lines), text => { output += text; }, line => saves.push(line));
    const written = output.trimEnd().split("\n").map(line => JSON.parse(line));
    return { result, written, saves };
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

describe("playInteractive", () => {
    test("writes a line of JSON for the start, and for each line read", async () => {
        const { result, written } = await play(await load(SHOP), ["look around", "", "1", "Leave"]);

        expect(result.success).toBe(true);
        expect(written).toHaveLength(4);
        expect(written.map(w => w.steps.map((s: { text: string }) => s.text))).toEqual([
            ["You're outside a shop. You have 10 gold. [Go in] or [look around]."],
            ["There's a sign on the door."],
            ["\"Welcome!\" You have 7 gold left. [Leave]"],
            ["You walk off down the street."],
        ]);
        expect(written[2].choices).toEqual([{ number: 1, text: "Leave", section: "street" }]);
        expect(written[2].attributes).toMatchObject({ gold: 7 });
        expect(written[3]).toMatchObject({ success: true, section: "street", ending: true, choices: [] });
        expect(written[0].save).toBeUndefined();
        expect(result.steps.map(s => s.choice)).toEqual([undefined, "look around", "Go in", "Leave"]);
    });

    test("plays the same as --play", async () => {
        const playable = await load(SHOP);
        const once = await playStory(playable, { choose: ["look around", "Go in", "Leave"] });
        const { result } = await play(playable, ["look around", "Go in", "Leave"]);
        expect(result.steps).toEqual(once.steps);
    });

    test("carries on after a link that isn't there, saying what the links are", async () => {
        const { result, written } = await play(await load(SHOP), ["Leave", "Go in"]);

        expect(written[1]).toMatchObject({
            success: false, steps: [], section: "_default",
            stopped: "There's no link \"Leave\" to click. The links are: \"Go in\", \"look around\".",
        });
        expect(written[2]).toMatchObject({ success: true, section: "shop" });
        expect(result.success).toBe(false);
        expect(result.hasErrors).toBe(false);
    });

    test("clicks --choose links first, all in the first line", async () => {
        const { written } = await play(await load(SHOP), ["Leave"], { choose: ["Go in"] });
        expect(written).toHaveLength(2);
        expect(written[0].steps).toHaveLength(2);
        expect(written[0].section).toBe("shop");
        expect(written[1].section).toBe("street");
    });

    test("fills in text boxes with :input, again if they're filled in already", async () => {
        const playable = await load(`What's your name? <input type="text" data-attribute="name" required> [[Go on]](next)

[[next]]:
Hello, {{name}}.`);
        const { written, result } = await play(playable, ["Go on", ":input name=Sam", ":input name=Jo Smith", "Go on"], { inputs: { name: "" } });

        expect(written[1].stopped).toBe("The link \"Go on\" can't be clicked until the text boxes are filled in properly. Use :input to fill them in.");
        expect(written[2]).toMatchObject({ success: true, steps: [] });
        expect(written[2].choices[0].needsInput).toBeUndefined();
        expect(written[4].steps[0].text).toBe("Hello, Jo Smith.");
        expect(result.inputs).toEqual({ name: "Jo Smith" });
    });

    test("reports commands it doesn't know, and shows the attributes", async () => {
        const { written } = await play(await load(SHOP), [":nope", ":input nothing", ":attributes"]);
        expect(written[1].stopped).toBe("There's no command \":nope\". The commands are :input attribute=value and :attributes.");
        expect(written[2].stopped).toBe(":input should be followed by attribute=value, not \"nothing\".");
        expect(written[3]).toMatchObject({ success: true, attributes: { gold: 10 } });
    });

    test("gives the game after each line, to save, and carries on from a saved game", async () => {
        const playable = await load(SHOP);
        const { saves } = await play(playable, ["Go in"]);
        expect(saves).toHaveLength(2);

        const { written } = await play(playable, ["Leave"], { save: saves[1].save });
        expect(written[0].section).toBe("shop");
        expect(written[1]).toMatchObject({ section: "street", ending: true });
    });

    test("stops at once if the story can't start", async () => {
        const { result, written } = await play(await load(SHOP), ["Go in"], { start: "nowhere" });
        expect(written).toHaveLength(1);
        expect(written[0].stopped).toBe("There's no section called \"nowhere\".");
        expect(result.success).toBe(false);
    });

    test("writes what --play would, without --json", async () => {
        let output = "";
        await playInteractive(await load(SHOP), {}, linesOf(["Go in", ":attributes"]), text => { output += text; });
        expect(output).toContain("> Go in\n(section \"shop\")\n\n\"Welcome!\" You have 7 gold left. [Leave]\n\nChoices (in section \"shop\"):\n  1. Leave -> section \"street\"\n\n");
        expect(output).toContain("Attributes:\n  turns = 1\n  gold = 7");
    });

    test("is quicker than --play for a long story", async () => {
        // A loop of 200 clicks, which with --play --save would be 200 runs
        const playable = await load(`[[Start]](a)

[[a]]:
@set n += 1
A {{n}} [[Go on]](b)

[[b]]:
B [[Go on]](a)`);
        const { written } = await play(playable, ["Start", ...Array(200).fill("Go on")]);
        expect(written).toHaveLength(202);
        expect(written[201].attributes.n).toBe(101);
    }, 20000); // under a second locally, but CI can be much slower when its runner is busy
});

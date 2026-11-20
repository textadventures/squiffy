// Playthrough tests (#499): a playthrough recorded with --play --record, as a .squiffy-test file,
// and replayed with --test to find where the story now does something different. A test file has
// the seed and anything else needed to play the story the same way again, then the links clicked,
// each with the sections and passages it went to and the attributes it changed:
//
//   # A playthrough of the story, recorded with --play --record.
//   seed 42
//   input name=Sam
//
//   went "start"
//   set gold = 10
//
//   > Go north
//   went "north"
//   went "north" "look"
//   set gold = 12
//
// The first step, before any "> " line, is the start of the story.

import fs from "fs";
import path from "path";
import { BUILD_FOLDER, isAlwaysSkipped } from "squiffy-compiler";
import { playStory, type PlayableStory, type PlayResult } from "./play.js";

export const TEST_EXTENSION = ".squiffy-test";

export interface Place {
    section: string;
    passage?: string;
}

export interface TestStep {
    // The link clicked, or undefined for the start of the story
    choice?: string;
    went: Place[];
    // The attributes the step set, and the ones it removed
    set: Record<string, unknown>;
    unset: string[];
}

export interface PlaythroughTest {
    // The comments at the top of the file, without their "#", kept when it's recorded again
    comments: string[];
    seed: number;
    start?: string;
    inputs: Record<string, string>;
    steps: TestStep[];
}

export const DEFAULT_COMMENTS = [
    " A playthrough of the story, recorded with --play --record.",
    " Run it with --test, or record it again with --test --update.",
];

// Attributes the runtime sets on every click, from the links clicked and where they went, so they
// say nothing the test doesn't already
const IGNORED_ATTRIBUTES = new Set(["turns", "previous", "previous_section"]);

// ---- From a playthrough ----

// The test that a playthrough would make. The result needs attributes for each step, so
// playStory's stepAttributes option.
export function testFromResult(result: PlayResult, options: { seed: number; start?: string; inputs?: Record<string, string>; comments?: string[] }): PlaythroughTest {
    let before: Record<string, unknown> = {};
    const steps = result.steps.map(step => {
        const after = step.attributes ?? {};
        const set: Record<string, unknown> = {};
        for (const [name, value] of Object.entries(after)) {
            if (IGNORED_ATTRIBUTES.has(name)) continue;
            if (!(name in before) || JSON.stringify(before[name]) !== JSON.stringify(value)) set[name] = value;
        }
        const unset = Object.keys(before).filter(name => !(name in after) && !IGNORED_ATTRIBUTES.has(name));
        before = after;
        return {
            ...(step.choice !== undefined ? { choice: step.choice } : {}),
            went: step.went.map(p => p.passage !== undefined ? { section: p.section, passage: p.passage } : { section: p.section }),
            set,
            unset,
        };
    });
    return {
        comments: options.comments ?? DEFAULT_COMMENTS,
        seed: options.seed,
        ...(options.start !== undefined ? { start: options.start } : {}),
        inputs: options.inputs ?? {},
        steps,
    };
}

// Plays the story the way a test says, and returns what happened, as a test
export async function replay(playable: PlayableStory, test: PlaythroughTest): Promise<{ result: PlayResult; actual: PlaythroughTest }> {
    const result = await playStory(playable, {
        start: test.start,
        inputs: test.inputs,
        choose: test.steps.slice(1).map(step => step.choice!),
        seed: test.seed,
        stepAttributes: true,
    });
    return { result, actual: testFromResult(result, test) };
}

// ---- The file ----

const SIMPLE_NAME = /^[A-Za-z_$][\w$.]*$/;
const formatName = (name: string) => SIMPLE_NAME.test(name) ? name : JSON.stringify(name);
const formatPlace = (place: Place) =>
    place.passage !== undefined ? `${JSON.stringify(place.section)} ${JSON.stringify(place.passage)}` : JSON.stringify(place.section);

export function formatTest(test: PlaythroughTest): string {
    const lines = test.comments.map(c => `#${c}`);
    lines.push(`seed ${test.seed}`);
    if (test.start !== undefined) lines.push(`start ${JSON.stringify(test.start)}`);
    for (const [attribute, value] of Object.entries(test.inputs)) lines.push(`input ${attribute}=${value}`);
    for (const step of test.steps) {
        lines.push("");
        if (step.choice !== undefined) lines.push(`> ${step.choice}`);
        for (const place of step.went) lines.push(`went ${formatPlace(place)}`);
        for (const [name, value] of Object.entries(step.set)) lines.push(`set ${formatName(name)} = ${JSON.stringify(value)}`);
        for (const name of step.unset) lines.push(`unset ${formatName(name)}`);
    }
    return lines.join("\n") + "\n";
}

export class TestFileError extends Error {}

// Reads a JSON string from the start of some text, returning it and the rest of the text
function readString(text: string, line: number): [string, string] {
    const match = /^"(?:[^"\\]|\\.)*"/.exec(text);
    if (!match) throw new TestFileError(`Line ${line}: expected some text in double quotes, not ${text || "nothing"}.`);
    return [JSON.parse(match[0]), text.substring(match[0].length).trim()];
}

function readName(text: string, line: number): [string, string] {
    if (text.startsWith("\"")) return readString(text, line);
    const match = /^[^\s=]+/.exec(text);
    if (!match) throw new TestFileError(`Line ${line}: expected an attribute name.`);
    return [match[0], text.substring(match[0].length).trim()];
}

export function parseTest(text: string): PlaythroughTest {
    const lines = text.split(/\r?\n/);
    const comments: string[] = [];
    let i = 0;
    for (; i < lines.length && lines[i].startsWith("#"); i++) comments.push(lines[i].substring(1));

    let seed: number | undefined;
    let start: string | undefined;
    const inputs: Record<string, string> = {};
    const steps: TestStep[] = [{ went: [], set: {}, unset: [] }];
    for (; i < lines.length; i++) {
        const number = i + 1;
        const line = lines[i].trim();
        if (!line || line.startsWith("#")) continue;
        const step = steps[steps.length - 1];
        const space = line.indexOf(" ");
        const keyword = space < 0 ? line : line.substring(0, space);
        const rest = space < 0 ? "" : line.substring(space + 1).trim();
        if (keyword == ">") {
            if (!rest) throw new TestFileError(`Line ${number}: expected the text of a link after "> ".`);
            steps.push({ choice: rest, went: [], set: {}, unset: [] });
        }
        else if (keyword == "went") {
            const [section, after] = readString(rest, number);
            if (!after) {
                step.went.push({ section });
            }
            else {
                const [passage, extra] = readString(after, number);
                if (extra) throw new TestFileError(`Line ${number}: unexpected ${extra}.`);
                step.went.push({ section, passage });
            }
        }
        else if (keyword == "set") {
            const [name, after] = readName(rest, number);
            if (!after.startsWith("=")) throw new TestFileError(`Line ${number}: expected "=" after the attribute name.`);
            try {
                step.set[name] = JSON.parse(after.substring(1));
            }
            catch {
                throw new TestFileError(`Line ${number}: the value of ${name} should be JSON, such as 12, "text" or true.`);
            }
        }
        else if (keyword == "unset") {
            const [name, after] = readName(rest, number);
            if (after) throw new TestFileError(`Line ${number}: unexpected ${after}.`);
            step.unset.push(name);
        }
        else if (steps.length > 1 || step.went.length || Object.keys(step.set).length || step.unset.length) {
            throw new TestFileError(`Line ${number}: expected "> ", "went", "set" or "unset", not "${keyword}".`);
        }
        else if (keyword == "seed") {
            if (!/^-?\d+$/.test(rest)) throw new TestFileError(`Line ${number}: the seed should be a whole number.`);
            seed = Number(rest);
        }
        else if (keyword == "start") {
            start = readString(rest, number)[0];
        }
        else if (keyword == "input") {
            const equals = rest.indexOf("=");
            if (equals < 1) throw new TestFileError(`Line ${number}: an input should be attribute=value.`);
            inputs[rest.substring(0, equals)] = rest.substring(equals + 1);
        }
        else {
            throw new TestFileError(`Line ${number}: expected "seed", "start", "input", "went", "set", "unset" or "> ", not "${keyword}".`);
        }
    }
    if (seed === undefined) throw new TestFileError("There's no seed line.");
    return { comments, seed, ...(start !== undefined ? { start } : {}), inputs, steps };
}

// ---- Comparing ----

export interface TestOutcome {
    passed: boolean;
    // The step that went differently: 1 for the start of the story, 2 for the first link clicked
    step?: number;
    choice?: string;
    differences: string[];
    // What happened instead, to record with --update, if play got to the end without errors
    actual?: PlaythroughTest;
}

const describePlace = (place: Place) =>
    place.passage !== undefined ? `passage "${place.passage}" in section "${place.section}"` : `section "${place.section}"`;
const describePlaces = (places: Place[]) => places.length ? places.map(describePlace).join(", then ") : "nowhere";
const samePlaces = (a: Place[], b: Place[]) => JSON.stringify(a) === JSON.stringify(b);

const describeChange = (step: TestStep, name: string) =>
    name in step.set ? `set to ${JSON.stringify(step.set[name])}` : step.unset.includes(name) ? "removed" : "not changed";

export function compare(expected: PlaythroughTest, result: PlayResult, actual: PlaythroughTest): TestOutcome {
    for (const [i, want] of expected.steps.entries()) {
        const got = actual.steps[i];
        const where = { step: i + 1, ...(want.choice !== undefined ? { choice: want.choice } : {}) };
        if (!got) {
            // Play stopped at this step, e.g. as the link isn't there any more
            return { passed: false, ...where, differences: [result.stopped ?? "Play stopped before this step."] };
        }
        const differences: string[] = [];
        if (!samePlaces(want.went, got.went)) {
            differences.push(`Went to ${describePlaces(got.went)}, but expected ${describePlaces(want.went)}.`);
        }
        const names = new Set([...Object.keys(want.set), ...want.unset, ...Object.keys(got.set), ...got.unset]);
        for (const name of names) {
            const wanted = describeChange(want, name);
            const happened = describeChange(got, name);
            if (wanted != happened) differences.push(`${formatName(name)} was ${happened}, but expected ${wanted}.`);
        }
        const errors = result.steps[i].errors;
        differences.push(...errors.map(e => `Error: ${e}`));
        if (differences.length) {
            return { passed: false, ...where, differences, ...(result.success ? { actual } : {}) };
        }
    }
    if (result.stopped) return { passed: false, differences: [result.stopped] };
    return { passed: true, differences: [] };
}

export async function runTest(playable: PlayableStory, test: PlaythroughTest): Promise<TestOutcome> {
    const { result, actual } = await replay(playable, test);
    return compare(test, result, actual);
}

// ---- Finding the tests ----

// The test files in a folder and below it, leaving out the build folder, node_modules and hidden
// folders, in order
export function findTestFiles(target: string, root: string): string[] {
    if (fs.statSync(target).isFile()) return [target];
    const build = path.resolve(root, BUILD_FOLDER);
    const result: string[] = [];
    const walk = (folder: string) => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const full = path.join(folder, entry.name);
            if (entry.isDirectory()) {
                if (full != build && !isAlwaysSkipped(`${entry.name}/x`)) walk(full);
            }
            else if (entry.name.endsWith(TEST_EXTENSION)) {
                result.push(full);
            }
        }
    };
    walk(target);
    return result.sort();
}

// ---- Reporting ----

export interface TestFileResult extends Omit<TestOutcome, "actual"> {
    file: string;
    // Recorded again with --update
    updated?: boolean;
    // Why it couldn't be recorded again, with --update
    notUpdated?: string;
}

export function formatTestResults(results: TestFileResult[], notes: string[] = []): string {
    const lines = notes.map(note => `(${note})`);
    for (const result of results) {
        if (result.passed) {
            lines.push(`PASS ${result.file}`);
            continue;
        }
        lines.push(`${result.updated ? "UPDATED" : "FAIL"} ${result.file}`);
        if (result.step !== undefined) {
            lines.push(`  At step ${result.step}${result.choice !== undefined ? ` (> ${result.choice})` : " (the start of the story)"}:`);
        }
        for (const difference of result.differences) lines.push(`    ${difference}`);
        if (result.notUpdated) lines.push(`  Not recorded again: ${result.notUpdated}`);
    }
    const failed = results.filter(r => !r.passed && !r.updated).length;
    const updated = results.filter(r => r.updated).length;
    const passed = results.length - failed - updated;
    lines.push("");
    lines.push(`${results.length} test${results.length == 1 ? "" : "s"}: ${passed} passed, ${failed} failed${updated ? `, ${updated} recorded again` : ""}.`);
    return lines.join("\n");
}

// --play --interactive (#530): plays a story in one process, reading what to do from standard
// input a line at a time, and writing what happened after each line. --play compiles the story
// and sets up jsdom every time it's run, which is about a second a click when an agent plays a
// long story a step at a time with --save; this does that once.
//
// Each line is a link to click, by its text or its number, or one of these:
//
//   :input attribute=value   puts text in a text box, now or when it's shown
//   :attributes              shows the story's attributes
//
// After each line, the output is what --play would print for it, or with --json, the same JSON
// on one line, so a program can read a line for each line it writes. A link that isn't there
// doesn't end play, as it does for --play: the output says so, and the next line is read.

import { formatPlayResult, StoryPlayer, type PlayableStory, type PlayOptions, type PlayResult, type PlayStep } from "./play.js";

export const INPUT_COMMAND = ":input";
export const ATTRIBUTES_COMMAND = ":attributes";

export interface InteractiveOptions extends PlayOptions {
    json?: boolean;
    // With text output, show the attributes after every line, as --attributes does
    showAttributes?: boolean;
}

export interface InteractiveResult {
    // False if any line had errors, or a link that couldn't be clicked
    success: boolean;
    // Every step, from the start, for --record
    steps: PlayStep[];
    // Whether the story had errors, or couldn't start, so a test can't be recorded from it
    hasErrors: boolean;
    inputs: Record<string, string>;
}

// Splits attribute=value, or returns undefined if it isn't that
export function parseInput(text: string): { attribute: string; value: string } | undefined {
    const equals = text.indexOf("=");
    if (equals < 1) return undefined;
    return { attribute: text.substring(0, equals).trim(), value: text.substring(equals + 1) };
}

export async function playInteractive(
    playable: PlayableStory,
    options: InteractiveOptions,
    lines: AsyncIterable<string>,
    write: (text: string) => void,
    // Called after each line, e.g. to save the game for --save
    afterLine?: (result: PlayResult) => void,
): Promise<InteractiveResult> {
    const { choose = [], json, showAttributes, ...openOptions } = options;
    const opened = await StoryPlayer.open(playable, { ...openOptions, inputHint: INPUT_COMMAND });
    const player = opened.player;
    const allSteps: PlayStep[] = [];
    let success = true;
    let hasErrors = false;
    let first = true;

    // Writes what happened for a line: the steps it took, or why it couldn't
    const report = (steps: PlayStep[], stopped?: string, extra: { error?: string } = {}) => {
        const state = player.state();
        const errors = steps.some(step => step.errors.length);
        const result: PlayResult = {
            success: !stopped && !errors && !extra.error,
            steps,
            section: state.section,
            ending: state.ending,
            choices: state.choices,
            attributes: state.attributes,
            ...((stopped ?? extra.error) ? { stopped: stopped ?? extra.error } : {}),
            notes: first ? player.notes : [],
            save: state.save,
            ...player.labels(steps, state),
        };
        first = false;
        if (!result.success) success = false;
        if (errors) hasErrors = true;
        allSteps.push(...steps);
        if (json) {
            // The saved game is for --save, and is mostly the HTML on the screen
            const lineSteps = steps.map(step => ({ ...step, attributes: undefined }));
            write(JSON.stringify({ ...result, steps: lineSteps, save: undefined }) + "\n");
        }
        else {
            write(formatPlayResult(result, !!showAttributes, INPUT_COMMAND) + "\n\n");
        }
        afterLine?.(result);
        return result;
    };

    try {
        // The start, and any links to click first, from --choose and --choices
        const steps: PlayStep[] = opened.step ? [opened.step] : [];
        let stopped = opened.stopped;
        if (stopped) {
            hasErrors = true;
            report(steps, stopped);
            return { success: false, steps: allSteps, hasErrors, inputs: player.currentInputs };
        }
        for (const choice of choose) {
            const chosen = await player.choose(choice);
            if (chosen.step) steps.push(chosen.step);
            if (chosen.stopped) {
                stopped = chosen.stopped;
                break;
            }
        }
        report(steps, stopped);

        for await (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;
            if (line.startsWith(":")) {
                const [command, ...rest] = line.split(/\s+/);
                if (command == INPUT_COMMAND) {
                    const input = parseInput(rest.join(" "));
                    if (!input) {
                        report([], undefined, { error: `${INPUT_COMMAND} should be followed by attribute=value, not "${rest.join(" ")}".` });
                        continue;
                    }
                    await player.setInputs({ [input.attribute]: input.value });
                    report([]);
                }
                else if (command == ATTRIBUTES_COMMAND) {
                    if (json) report([]);
                    else write(formatAttributes(player.state().attributes) + "\n\n");
                }
                else {
                    report([], undefined, { error: `There's no command "${command}". The commands are ${INPUT_COMMAND} attribute=value and ${ATTRIBUTES_COMMAND}.` });
                }
                continue;
            }
            const chosen = await player.choose(line);
            report(chosen.step ? [chosen.step] : [], chosen.stopped);
        }
        return { success, steps: allSteps, hasErrors, inputs: player.currentInputs };
    }
    finally {
        player.close();
    }
}

const formatAttributes = (attributes: Record<string, unknown>) =>
    ["Attributes:", ...Object.entries(attributes).map(([name, value]) => `  ${name} = ${JSON.stringify(value)}`)].join("\n");

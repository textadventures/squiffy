// Importing a Twine story (#378): Open file converts a .twee file, or Twine's published or
// archive HTML, into a new Squiffy story, asking first.

import { convertTwine, formatTwineProblems, type TwineConversionResult, TwineParseError } from "squiffy-compiler";
import { confirmDialog } from "./confirm.js";

export const TWINE_FILE_PATTERN = /\.(twee|tw|html?)$/i;
export const TWINE_ACCEPT = ".twee,.tw,.html,.htm";
// Lists what couldn't be converted exactly, in the new story's folder
export const TWINE_PROBLEMS_FILE = "twine-import.txt";

export interface ConvertedTwine {
    // The story's files, by path
    files: Map<string, string>;
    mainFile: string;
    title: string;
    // The number of things that couldn't be converted exactly
    problems: number;
}

// Converts a Twine story, once the author says to. Null if they cancel. Throws if the file
// isn't a Twine story.
export async function convertTwineFile(fileName: string, text: string): Promise<ConvertedTwine | null> {
    let result;
    try {
        result = convertTwine(text);
    }
    catch (e) {
        if (e instanceof TwineParseError) throw new Error(`${fileName} isn't a Twine story: there's no story data in it.`, { cause: e });
        throw e;
    }
    const name = result.title ? `"${result.title}"` : fileName;
    if (!(await confirmDialog(`${name} is a Twine story (${describe(result)}). Convert it to Squiffy?`, { confirmLabel: "Convert" }))) {
        return null;
    }
    return converted(result, fileName);
}

// Twee pasted into the script (#711): a ":: Name" line, as each passage starts with, and another
// one or a Twine link. Squiffy has nothing that starts a line with "::".
export function looksLikeTwee(text: string): boolean {
    const passages = text.match(/^::[ \t]*[^\s:]/gm)?.length ?? 0;
    return passages >= 2 || (passages == 1 && /\[\[[^\]]+\]\]/.test(text));
}

// Converts pasted Twee into a new story, if the author says to. Null if it isn't a Twine story
// after all, or they'd rather paste it as it is.
export async function convertPastedTwee(text: string): Promise<ConvertedTwine | null> {
    let result;
    try {
        result = convertTwine(text);
    }
    catch {
        return null;
    }
    if (!result.passages) return null;
    const name = result.title ? `"${result.title}"` : "a Twine story";
    if (!(await confirmDialog(
        `This looks like ${name} (${describe(result)}). Convert it into a new Squiffy story? This story stays as it is.`,
        { confirmLabel: "Convert into a new story", cancelLabel: "Paste it here" },
    ))) {
        return null;
    }
    return converted(result, "the pasted text");
}

function describe(result: TwineConversionResult): string {
    return `${result.format || "Twine"}, ${result.passages} passage${result.passages == 1 ? "" : "s"}`;
}

function converted(result: TwineConversionResult, source: string): ConvertedTwine {
    const files = new Map(Object.entries(result.files));
    files.set(TWINE_PROBLEMS_FILE, formatTwineProblems(result, source));
    return { files, mainFile: result.main, title: result.title, problems: result.problems.length };
}

// What to tell the author once it's converted
export function twineImportMessage(converted: ConvertedTwine): string {
    return converted.problems == 0
        ? "Converted from Twine."
        : `Converted from Twine. ${converted.problems} thing${converted.problems == 1 ? "" : "s"} couldn't be converted exactly: they're listed in ${TWINE_PROBLEMS_FILE}.`;
}

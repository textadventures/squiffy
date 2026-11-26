// Importing a Twine story (#378): Open file converts a .twee file, or Twine's published or
// archive HTML, into a new Squiffy story, asking first.

import { convertTwine, formatTwineProblems, TwineParseError } from "squiffy-compiler";
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
    const passages = `${result.passages} passage${result.passages == 1 ? "" : "s"}`;
    if (!(await confirmDialog(`${name} is a Twine story (${result.format || "Twine"}, ${passages}). Convert it to Squiffy?`, { confirmLabel: "Convert" }))) {
        return null;
    }
    const files = new Map(Object.entries(result.files));
    files.set(TWINE_PROBLEMS_FILE, formatTwineProblems(result, fileName));
    return { files, mainFile: result.main, title: result.title, problems: result.problems.length };
}

// What to tell the author once it's converted
export function twineImportMessage(converted: ConvertedTwine): string {
    return converted.problems == 0
        ? "Converted from Twine."
        : `Converted from Twine. ${converted.problems == 1 ? "1 thing couldn't be converted exactly: it's" : `${converted.problems} things couldn't be converted exactly: they're`} listed in ${TWINE_PROBLEMS_FILE}.`;
}

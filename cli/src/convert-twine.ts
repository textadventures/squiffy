import * as fs from "fs";
import path from "path";
import { convertTwine, formatTwineProblems, TwineParseError } from "squiffy-compiler";

export const PROBLEMS_FILENAME = "twine-import.txt";

// Converts a Twine story (#378), in Twee or Twine's HTML, into a new folder with a Squiffy story
// in it: the story file, a squiffy.json, the story's CSS and JavaScript, and twine-import.txt,
// which lists what couldn't be converted exactly. The folder is next to the Twine file, with the
// same name, unless another is given. Returns false if the story couldn't be converted.
export const convertTwineFile = (inputFilename: string, outputFolder?: string): boolean => {
    console.log("Loading " + inputFilename);
    if (!fs.existsSync(inputFilename)) {
        console.error(`${inputFilename} doesn't exist.`);
        return false;
    }

    const parsed = path.parse(path.resolve(inputFilename));
    const folder = path.resolve(outputFolder ?? path.join(parsed.dir, parsed.name));
    if (fs.existsSync(folder) && (!fs.statSync(folder).isDirectory() || fs.readdirSync(folder).length > 0)) {
        console.error(`${folder} already exists. Choose another folder with --out, or move it out of the way.`);
        return false;
    }

    let result;
    try {
        result = convertTwine(fs.readFileSync(inputFilename, "utf8"));
    }
    catch (e) {
        if (e instanceof TwineParseError) {
            console.error(e.message);
            return false;
        }
        throw e;
    }

    fs.mkdirSync(folder, { recursive: true });
    for (const [name, text] of Object.entries(result.files)) {
        fs.writeFileSync(path.join(folder, name), text);
    }
    fs.writeFileSync(path.join(folder, PROBLEMS_FILENAME), formatTwineProblems(result, parsed.base));

    const relative = path.relative(process.cwd(), folder) || ".";
    console.log(`Converted ${result.passages} passage${result.passages == 1 ? "" : "s"} from ${result.format || "Twine"} into ${path.join(relative, result.main)}.`);
    if (result.problems.length > 0) {
        console.warn(`${result.problems.length} thing${result.problems.length == 1 ? "" : "s"} couldn't be converted exactly. They're listed in ${path.join(relative, PROBLEMS_FILENAME)}.`);
    }
    console.log(`To try it: npx @textadventures/squiffy-cli ${relative} -s`);
    return true;
};

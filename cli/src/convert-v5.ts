import * as fs from "fs";
import path from "path";
import { convertV5Syntax, PROJECT_FILENAME } from "squiffy-compiler";
import { convertV6Story } from "./convert-v6.js";

// Converts a Squiffy 5 story to Squiffy 7: its text processor syntax to Handlebars, then, as
// --convert-v6 does, its setters to Squiffy 7's rules, adding a squiffy.json. The original file
// is kept with a .bak extension. If some of the Squiffy 5 syntax couldn't be converted, it stops
// after the first step, as the setters can't be converted until that's fixed. A story that
// already has a squiffy.json only needs the first step. Returns false if the file couldn't be
// written, or the setters couldn't be converted.
export const convertV5File = async (inputFilename: string): Promise<boolean> => {
    console.log("Loading " + inputFilename);

    const result = convertV5Syntax(fs.readFileSync(inputFilename).toString());

    if (result.converted == 0 && result.problems.length == 0) {
        console.log("No Squiffy 5 text processor syntax found.");
    }

    if (result.converted > 0) {
        const backupFilename = inputFilename + ".bak";
        if (fs.existsSync(backupFilename)) {
            console.error(`${backupFilename} already exists. Move or delete it, then try again.`);
            return false;
        }
        fs.copyFileSync(inputFilename, backupFilename);
        fs.writeFileSync(inputFilename, result.script);
        console.log(`Converted ${result.converted} Squiffy 5 text processor command${result.converted == 1 ? "" : "s"}. The original file has been saved as ${backupFilename}`);
    }

    if (result.problems.length > 0) {
        console.warn("These couldn't be converted automatically, so have been left as they are:");
        for (const problem of result.problems) {
            console.warn(`  line ${problem.line}: ${problem.text}`);
            console.warn(`    ${problem.reason}`);
        }
        console.warn("Once you've fixed them, run with --convert-v6 for Squiffy 7's rules for setting attributes."
            + (result.converted > 0 ? ` Move ${path.basename(inputFilename)}.bak somewhere else first, as that keeps a backup too.` : ""));
        return true;
    }

    if (hasProjectFile(path.dirname(path.resolve(inputFilename)))) return true;
    const backedUp = new Set(result.converted > 0 ? [path.resolve(inputFilename)] : []);
    return convertV6Story(inputFilename, backedUp);
};

// Whether there's a squiffy.json in the folder or above, which makes it a Squiffy 7 story already
const hasProjectFile = (folder: string): boolean => {
    for (let dir = folder; ; dir = path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, PROJECT_FILENAME))) return true;
        if (path.dirname(dir) == dir) return false;
    }
};

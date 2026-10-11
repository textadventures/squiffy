import * as fs from "fs";
import { convertV5Syntax } from "squiffy-compiler";

// Converts Squiffy 5 text processor syntax in a .squiffy file to Squiffy 6 Handlebars syntax.
// The original file is kept with a .bak extension. Returns false if the file couldn't be written.
export const convertV5File = (inputFilename: string): boolean => {
    console.log("Loading " + inputFilename);

    const result = convertV5Syntax(fs.readFileSync(inputFilename).toString());

    if (result.converted == 0 && result.problems.length == 0) {
        console.log("No Squiffy 5 text processor syntax found.");
        return true;
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
    }

    return true;
};

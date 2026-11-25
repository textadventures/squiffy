import * as fs from "fs";
import path from "path";
import { analyse, convertV5Syntax, findV5Syntax, PROJECT_FILENAME, type V5ConversionResult } from "squiffy-compiler";
import { convertV6Story } from "./convert-v6.js";
import { externalFiles } from "./external-files.js";

// Converts a Squiffy 5 story to Squiffy 7: its text processor syntax to Handlebars, in the main
// file and every .squiffy file it @imports, then, as --convert-v6 does, its setters to Squiffy 7's
// rules, adding a squiffy.json. Each changed file is kept with a .bak extension. If some of the
// Squiffy 5 syntax couldn't be converted, it stops after the first step, as the setters can't be
// converted until that's fixed. JavaScript it couldn't convert, which uses jQuery, doesn't stop
// it. A story that already has a squiffy.json only needs the first step. Returns false if the
// files couldn't be written, or the setters couldn't be converted.
export const convertV5File = async (inputFilename: string): Promise<boolean> => {
    const mainFile = path.resolve(inputFilename);
    const root = path.dirname(mainFile);
    console.log("Loading " + inputFilename);

    const files = [mainFile, ...await importedFiles(mainFile)];
    const results: { filename: string, result: V5ConversionResult }[] = files.map(filename =>
        ({ filename, result: convertV5Syntax(fs.readFileSync(filename).toString()) }));
    // Where a line is, e.g. "line 3", or "chapter2.squiffy line 3" in an @imported file
    const where = (filename: string, line: number) => `${filename == mainFile ? "" : path.relative(root, filename) + " "}line ${line}`;

    const changed = results.filter(({ result }) => result.converted > 0);
    if (changed.length == 0 && results.every(({ result }) => result.problems.length == 0)) {
        console.log("No Squiffy 5 text processor syntax found.");
    }

    // Check every backup first, so nothing is written if one's in the way
    for (const { filename } of changed) {
        if (fs.existsSync(filename + ".bak")) {
            console.error(`${filename}.bak already exists. Move or delete it, then try again.`);
            return false;
        }
    }
    for (const { filename, result } of changed) {
        fs.copyFileSync(filename, filename + ".bak");
        fs.writeFileSync(filename, result.script);
        const inFile = filename == mainFile ? "" : ` in ${path.relative(root, filename)}`;
        console.log(`Converted ${result.converted} Squiffy 5 text processor command${result.converted == 1 ? "" : "s"}${inFile}. The original file has been saved as ${path.basename(filename)}.bak`);
    }

    const problems = results.flatMap(({ filename, result }) => result.problems.map(problem => ({ filename, ...problem })));
    if (problems.length > 0) {
        console.warn("These couldn't be converted automatically, so have been left as they are:");
        for (const problem of problems) {
            console.warn(`  ${where(problem.filename, problem.line)}: ${problem.text}`);
            console.warn(`    ${problem.reason}`);
        }
    }

    // Squiffy 5 syntax that's left stops the setters being converted. JavaScript doesn't.
    if (results.some(({ result }) => findV5Syntax(result.script).length > 0)) {
        console.warn("Once you've fixed them, run with --convert-v6 for Squiffy 7's rules for setting attributes."
            + (changed.length > 0 ? " Move the .bak files somewhere else first, as that keeps a backup too." : ""));
        return true;
    }

    if (hasProjectFile(root)) return true;
    return convertV6Story(inputFilename, new Set(changed.map(({ filename }) => filename)));
};

// The .squiffy files that a story's main file @imports, and those files @import
const importedFiles = async (mainFile: string): Promise<string[]> => {
    const analysis = await analyse({
        script: fs.readFileSync(mainFile).toString(),
        scriptBaseFilename: path.basename(mainFile),
        externalFiles: externalFiles(mainFile),
    });
    return analysis.files.slice(1).map(file => path.resolve(path.dirname(mainFile), file.filename ?? ""));
};

// Whether there's a squiffy.json in the folder or above, which makes it a Squiffy 7 story already
const hasProjectFile = (folder: string): boolean => {
    for (let dir = folder; ; dir = path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, PROJECT_FILENAME))) return true;
        if (path.dirname(dir) == dir) return false;
    }
};

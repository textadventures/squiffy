import * as fs from "fs";
import path from "path";
import { analyse, convertSetters, findV5Syntax, formatProjectFile, PROJECT_FILENAME } from "squiffy-compiler";
import { listSquiffyFiles } from "squiffy-compiler/node";
import { externalFiles } from "./external-files.js";

// Converts a Squiffy 6 story to Squiffy 7's rules for setters (#373): text in @set and link
// setters is quoted, and @name becomes name, in the main file and every .squiffy file it
// @imports. Then adds a squiffy.json, which is what turns the new rules on, leaving out any other
// .squiffy files in the folder so the story is made of the same files as before. Each changed
// file is kept with a .bak extension. Returns false if the story couldn't be converted.
export const convertV6Story = async (inputFilename: string): Promise<boolean> => {
    const mainFile = path.resolve(inputFilename);
    const root = path.dirname(mainFile);
    console.log("Loading " + mainFile);

    for (let dir = root; ; dir = path.dirname(dir)) {
        const projectFile = path.join(dir, PROJECT_FILENAME);
        if (fs.existsSync(projectFile)) {
            console.error(`${projectFile} already exists, so this story already uses Squiffy 7's rules for setters.`);
            return false;
        }
        if (path.dirname(dir) == dir) break;
    }

    const script = fs.readFileSync(mainFile).toString();
    if (findV5Syntax(script).length > 0) {
        console.error("This story looks like it uses Squiffy 5 text processor syntax. Run with --convert-v5 first.");
        return false;
    }

    // The story's files: the main file and the .squiffy files it @imports
    const analysis = await analyse({ script, scriptBaseFilename: path.basename(mainFile), externalFiles: externalFiles(mainFile) });
    if (!analysis.success) {
        console.error("The story has errors, so it can't be converted. Fix them, then try again.");
        return false;
    }
    const storyFiles = analysis.files.map((file, i) => i == 0 ? mainFile : path.resolve(root, file.filename ?? ""));

    // Convert everything first, so nothing is written if a .bak is in the way
    const changes: { filename: string, script: string, converted: number }[] = [];
    let problems = 0;
    for (const filename of storyFiles) {
        const result = convertSetters(fs.readFileSync(filename).toString());
        if (result.converted > 0) {
            if (fs.existsSync(filename + ".bak")) {
                console.error(`${filename}.bak already exists. Move or delete it, then try again.`);
                return false;
            }
            changes.push({ filename, script: result.script, converted: result.converted });
        }
        if (result.problems.length > 0) {
            if (problems == 0) console.warn("These couldn't be converted automatically, so have been left as they are:");
            for (const problem of result.problems) {
                console.warn(`  ${path.relative(root, filename)} line ${problem.line}: ${problem.text}`);
                console.warn(`    ${problem.reason}`);
            }
            problems += result.problems.length;
        }
    }

    for (const change of changes) {
        fs.copyFileSync(change.filename, change.filename + ".bak");
        fs.writeFileSync(change.filename, change.script);
        console.log(`Converted ${change.converted} setter${change.converted == 1 ? "" : "s"} in ${path.relative(root, change.filename)}. The original file has been saved as ${path.basename(change.filename)}.bak`);
    }
    if (changes.length == 0) {
        console.log("No setters needed converting.");
    }

    // squiffy.json makes every .squiffy file in the folder part of the story, so leave out the
    // ones that weren't
    const inStory = new Set(storyFiles);
    const exclude = (await listSquiffyFiles(root)).filter(file => !inStory.has(path.resolve(root, file)));
    fs.writeFileSync(path.join(root, PROJECT_FILENAME), formatProjectFile({ main: path.basename(mainFile), exclude }));
    console.log(`Added ${PROJECT_FILENAME}, so the story now uses Squiffy 7's rules for setters.`
        + (exclude.length ? ` It leaves out the other .squiffy files in the folder: ${exclude.join(", ")}.` : ""));
    return true;
};

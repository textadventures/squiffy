// Builds each example story in the repo's examples/ folder (each folder with a squiffy.json in it)
// into public/examples/<name>/, so the Examples page can link to it as a standalone game.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { compile } from "squiffy-compiler";
import { findStory } from "squiffy-compiler/node";
import { createPackage } from "@textadventures/squiffy-packager";
import { externalFiles } from "@textadventures/squiffy-cli";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(__dirname, "../../examples");
const outputDir = path.join(__dirname, "../public/examples");

async function packageExample(name: string): Promise<boolean> {
    console.log(`Packaging ${name}...`);

    const story = await findStory(path.join(examplesDir, name));
    const warnings: string[] = [];
    const result = await compile({
        scriptBaseFilename: path.basename(story.mainFile),
        script: fs.readFileSync(story.mainFile, "utf-8"),
        onWarning: message => warnings.push(message),
        externalFiles: externalFiles(story.mainFile),
        storyFiles: story.storyFiles,
        expressions: story.expressions,
        globalJs: true,
    });

    for (const warning of warnings) {
        console.warn(`  Warning: ${warning}`);
    }
    if (!result.success) {
        console.error(`  Failed to compile ${name}:`);
        result.errors.forEach(error => console.error(`    ${error}`));
        return false;
    }

    const pkg = await createPackage(result, { backButton: story.backButton, strings: story.strings });
    const exampleOutputDir = path.join(outputDir, name);
    fs.mkdirSync(exampleOutputDir, { recursive: true });
    for (const [filename, content] of Object.entries(pkg.files)) {
        fs.writeFileSync(path.join(exampleOutputDir, filename), content);
    }
    console.log(`  Packaged to public/examples/${name}/`);
    return true;
}

const names = fs.readdirSync(examplesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(examplesDir, entry.name, "squiffy.json")))
    .map(entry => entry.name)
    .sort();

if (names.length == 0) {
    console.error(`No examples found in ${examplesDir}`);
    process.exit(1);
}

fs.rmSync(outputDir, { recursive: true, force: true });

let failed = 0;
for (const name of names) {
    if (!await packageExample(name)) failed++;
}

if (failed > 0) {
    console.error(`${failed} example${failed == 1 ? "" : "s"} failed to build`);
    process.exit(1);
}

// Builds each example story in the repo's examples/ folder (each folder with a squiffy.json in it)
// into public/examples/<name>/, so the Examples page can link to it as a standalone game.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { findStory } from "squiffy-compiler/node";
import { createPackageFiles } from "@textadventures/squiffy-cli";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(__dirname, "../../examples");
const outputDir = path.join(__dirname, "../public/examples");

// Built as the CLI builds a story, so they have everything in their squiffy.json (panels,
// settings, ...), their stylesheets, and the images and sounds they use
async function packageExample(name: string): Promise<boolean> {
    console.log(`Packaging ${name}...`);
    const story = await findStory(path.join(examplesDir, name));
    return await createPackageFiles(story, path.join(outputDir, name), {
        backButton: story.backButton,
        saveButton: story.saveButton,
        strings: story.strings,
    });
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

// Builds each example story in the repo's examples/ folder (each folder with a squiffy.json in it)
// into public/examples/<name>/, so the Examples page can link to it as a standalone game, and zips
// its source into public/examples/<name>.zip, for the page to offer as a download that opens in the
// editor.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { zipSync } from "fflate";
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

// A local build (the CLI's build/ folder, or an old build next to the main file) isn't source
const OLD_BUILD_FILES = ["index.html", "story.js", "style.css", "squiffy.runtime.js", "squiffy.runtime.global.js"];

// The example's folder as a zip, with its files in a folder of the example's name
function zipSource(name: string) {
    const root = path.join(examplesDir, name);
    const oldBuild = fs.existsSync(path.join(root, "index.html"));
    const files: Record<string, Uint8Array> = {};
    const walk = (folder: string, prefix: string) => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name.startsWith(".") || entry.name == "node_modules") continue;
            if (!prefix && (entry.name == "build" || (oldBuild && OLD_BUILD_FILES.includes(entry.name)))) continue;
            const full = path.join(folder, entry.name);
            if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
            else files[`${name}/${prefix}${entry.name}`] = fs.readFileSync(full);
        }
    };
    walk(root, "");
    fs.writeFileSync(path.join(outputDir, `${name}.zip`), zipSync(files));
    console.log(`  Zipped its source to public/examples/${name}.zip (${Object.keys(files).length} files)`);
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
    else zipSource(name);
}

if (failed > 0) {
    console.error(`${failed} example${failed == 1 ? "" : "s"} failed to build`);
    process.exit(1);
}

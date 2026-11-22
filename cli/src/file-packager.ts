import * as fs from "fs";
import * as path from "path";
import { compile, convertSetters, findV5Syntax, formatDiagnostic } from "squiffy-compiler";
import type { StoryOnDisk } from "squiffy-compiler/node";
import { externalFiles } from "./external-files.js";
import { findAssets, findImportedFiles, findStylesheetAssets, getStoryText } from "./assets.js";
import { createPackage, PackageOptions } from "@textadventures/squiffy-packager";

// A story given as a filename is just that file and its @imports, as with no squiffy.json
const toStory = (input: string | StoryOnDisk): StoryOnDisk => typeof input == "string" ? { mainFile: input, expressions: false } : input;

// What to compile a story with, given its main file's text: shared with --play, so it plays the
// story as it's built
export const compileSettings = (story: StoryOnDisk, script: string) => ({
    scriptBaseFilename: path.basename(story.mainFile),
    script,
    externalFiles: externalFiles(story.mainFile),
    storyFiles: story.storyFiles,
    expressions: story.expressions,
    projectId: story.projectId,
    panels: story.panels,
    settings: story.settings,
    persistent: story.persistent,
});

async function getCompileResult(story: StoryOnDisk) {
    const inputFilename = story.mainFile;
    const inputFile = fs.readFileSync(inputFilename);
    const inputText = inputFile.toString();
    if (findV5Syntax(inputText).length > 0) {
        console.warn("This story looks like it uses Squiffy 5 text processor syntax. Run with --convert-v5 to convert it to Squiffy 6.");
    }
    else if (!story.expressions && convertSetters(inputText).converted > 0) {
        console.log("This story uses Squiffy 6's rules for @set and link setters. Run with --convert-v6 to convert it to Squiffy 7's.");
    }
    const result = await compile({ ...compileSettings(story, inputText), globalJs: true });
    for (const diagnostic of result.diagnostics) {
        if (diagnostic.severity == "error") {
            console.error(formatDiagnostic(diagnostic));
        }
        else {
            console.warn(formatDiagnostic(diagnostic));
        }
    }
    return result;
}

const logLoading = (story: StoryOnDisk) => {
    if (story.note) console.log(story.note);
    console.log("Loading " + (story.projectFile ?? story.mainFile));
};

export const writeScriptFile = async(input: string | StoryOnDisk, outputPath: string, outputFilename: string)=> {
    const story = toStory(input);
    logLoading(story);

    const result = await getCompileResult(story);

    if (!result.success) {
        console.log("Failed.");
        return false;
    }

    console.log(`Writing ${outputFilename}`);
    fs.mkdirSync(outputPath, { recursive: true });
    fs.writeFileSync(path.join(outputPath, outputFilename), await result.getJs());
};

export const createPackageFiles = async (input: string | StoryOnDisk, outputPath: string, options: PackageOptions = {}) => {
    const story = toStory(input);
    const inputFilename = story.mainFile;
    logLoading(story);

    const result = await getCompileResult(story);

    if (!result.success) {
        console.log("Failed.");
        return false;
    }

    // Asset files (images etc.) referenced by the story, and its own stylesheets and scripts. When the
    // other package files are written to the story's folder, alongside these, they only need to be
    // passed on for the zip or for inlining. When they're written somewhere else, such as a project's
    // build folder, they're copied there too.
    // Assets the story's stylesheets and scripts refer to, such as fonts, are included too.
    const imported = findImportedFiles(inputFilename, result);
    const importedText = Object.values(imported).map(bytes => new TextDecoder().decode(bytes)).join("\n");
    const assets = options.assets ?? {
        ...findAssets(inputFilename, getStoryText(result) + "\n" + importedText),
        ...findStylesheetAssets(inputFilename, result, imported),
        ...imported,
    };
    const assetPaths = Object.keys(assets);
    if (assetPaths.length > 0 && (options.createZip || options.inlineHtml)) {
        console.log(`Including asset${assetPaths.length == 1 ? "" : "s"}: ${assetPaths.join(", ")}`);
    }

    const pkg = await createPackage(result, { ...options, assets });
    const files = pkg.files;

    fs.mkdirSync(outputPath, { recursive: true });
    if (!options.inlineHtml && path.resolve(outputPath) != path.resolve(path.dirname(inputFilename))) {
        for (const [asset, bytes] of Object.entries(assets)) {
            // Package files take precedence, as in the zip
            if (asset in files) continue;
            console.log(`Copying ${asset}`);
            const filename = path.join(outputPath, asset);
            fs.mkdirSync(path.dirname(filename), { recursive: true });
            fs.writeFileSync(filename, bytes);
        }
    }

    for (const file of Object.keys(files)) {
        console.log(`Writing ${file}`);
        fs.writeFileSync(path.join(outputPath, file), files[file]);
    }

    if (options.createZip && pkg.zip) {
        console.log("Writing output.zip");
        fs.writeFileSync(path.join(outputPath, "output.zip"), pkg.zip);
    }

    console.log("Done.");
    return true;
};
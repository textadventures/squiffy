import * as fs from "fs";
import * as path from "path";
import { compile, convertSetters, findV5Syntax, formatDiagnostic, type CompileSuccess } from "squiffy-compiler";
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
    ignore: story.ignore,
});

// A story that's built to be published is compiled without its @test sections, which are for
// testing it. The story that --serve shows is compiled with them (testing), and without
// reporting its problems a second time.
async function getCompileResult(story: StoryOnDisk, testing = false) {
    const inputFilename = story.mainFile;
    const inputFile = fs.readFileSync(inputFilename);
    const inputText = inputFile.toString();
    if (testing) {
        return compile({ ...compileSettings(story, inputText), globalJs: true });
    }
    if (findV5Syntax(inputText).length > 0) {
        console.warn("This story looks like it uses Squiffy 5 text processor syntax. Run with --convert-v5 to convert it to Squiffy 6.");
    }
    else if (!story.expressions && convertSetters(inputText).converted > 0) {
        console.log("This story uses Squiffy 6's rules for @set and link setters. Run with --convert-v6 to convert it to Squiffy 7's.");
    }
    const result = await compile({ ...compileSettings(story, inputText), globalJs: true, omitTestSections: !story.startAnywhere });
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

// Asset files (images etc.) referenced by the story, and its own stylesheets and scripts.
// Assets the story's stylesheets and scripts refer to, such as fonts, are included too.
// The cover image in squiffy.json is published too, though the story itself needn't show it.
const storyAssets = (inputFilename: string, result: CompileSuccess, cover?: string): Record<string, Uint8Array> => {
    const imported = findImportedFiles(inputFilename, result);
    const importedText = Object.values(imported).map(bytes => new TextDecoder().decode(bytes)).join("\n");
    return {
        ...findAssets(inputFilename, getStoryText(result) + "\n" + importedText),
        ...findStylesheetAssets(inputFilename, result, imported),
        ...imported,
        ...coverAsset(inputFilename, cover),
    };
};

const coverAsset = (inputFilename: string, cover?: string): Record<string, Uint8Array> => {
    if (!cover) return {};
    const filename = path.join(path.dirname(inputFilename), cover);
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
        console.warn(`The cover image in squiffy.json, ${cover}, doesn't exist.`);
        return {};
    }
    return { [cover]: fs.readFileSync(filename) };
};

// What squiffy.json says about the story, for the page's <head>. The cover is left out if it
// isn't one of the files published with the story.
const storyDetails = (story: StoryOnDisk, assets: Record<string, Uint8Array>): PackageOptions => ({
    id: story.projectId, description: story.description, author: story.author, language: story.language,
    cover: story.cover !== undefined && story.cover in assets ? story.cover : undefined,
});

// The story's page as --serve shows it, for the author to test: with its @test sections, and
// able to start at any section. These are the files that differ from the ones createPackageFiles
// writes, which the server sends in their place, so the files on disk stay as they'll be
// published. Undefined if the story doesn't compile.
export const createTestingFiles = async (input: string | StoryOnDisk, options: PackageOptions = {}): Promise<Record<string, string> | undefined> => {
    const story = toStory(input);
    const result = await getCompileResult(story, true);
    if (!result.success) return undefined;
    const assets = options.assets ?? storyAssets(story.mainFile, result, story.cover);
    const pkg = await createPackage(result, { ...storyDetails(story, assets), ...options, createZip: false, startAnywhere: true, assets });
    return Object.fromEntries(Object.entries(pkg.files).filter(([name]) => name == "index.html" || name == "story.js"));
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

    // When the other package files are written to the story's folder, alongside its assets, they
    // only need to be passed on for the zip or for inlining. When they're written somewhere else,
    // such as a project's build folder, they're copied there too.
    const assets = options.assets ?? storyAssets(inputFilename, result, story.cover);
    const assetPaths = Object.keys(assets);
    if (assetPaths.length > 0 && (options.createZip || options.inlineHtml)) {
        console.log(`Including asset${assetPaths.length == 1 ? "" : "s"}: ${assetPaths.join(", ")}`);
    }

    const pkg = await createPackage(result, { ...storyDetails(story, assets), ...options, assets });
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
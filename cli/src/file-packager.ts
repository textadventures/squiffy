import * as fs from "fs";
import * as path from "path";
import { compile, findV5Syntax } from "squiffy-compiler";
import { externalFiles } from "./external-files.js";
import { findAssets, getStoryText } from "./assets.js";
import { createPackage, PackageOptions } from "@textadventures/squiffy-packager";

async function getCompileResult(inputFilename: string) {
    const inputFile = fs.readFileSync(inputFilename);
    const inputText = inputFile.toString();
    if (findV5Syntax(inputText).length > 0) {
        console.warn("This story looks like it uses Squiffy 5 text processor syntax. Run with --convert-v5 to convert it to Squiffy 6.");
    }
    return await compile({
        scriptBaseFilename: path.basename(inputFilename),
        script: inputText,
        onWarning: console.warn,
        externalFiles: externalFiles(inputFilename),
        globalJs: true,
    });
}

export const writeScriptFile = async(inputFilename: string, outputPath: string, outputFilename: string)=> {
    console.log("Loading " + inputFilename);

    const result = await getCompileResult(inputFilename);

    if (!result.success) {
        console.log("Failed.");
        return false;
    }

    console.log(`Writing ${outputFilename}`);
    fs.writeFileSync(path.join(outputPath, outputFilename), await result.getJs());
};

export const createPackageFiles = async (inputFilename: string, outputPath: string, options: PackageOptions = {}) => {
    console.log("Loading " + inputFilename);

    const result = await getCompileResult(inputFilename);

    if (!result.success) {
        console.log("Failed.");
        return false;
    }

    // Asset files (images etc.) referenced by the story. The other package files are written to the
    // story's folder, alongside these, so they only need to be passed on for the zip or for inlining.
    const assets = options.assets ?? findAssets(inputFilename, getStoryText(result));
    const assetPaths = Object.keys(assets);
    if (assetPaths.length > 0 && (options.createZip || options.inlineHtml)) {
        console.log(`Including asset${assetPaths.length == 1 ? "" : "s"}: ${assetPaths.join(", ")}`);
    }

    const pkg = await createPackage(result, { ...options, assets });
    const files = pkg.files;

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
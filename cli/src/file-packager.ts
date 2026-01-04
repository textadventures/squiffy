import * as fs from "fs";
import * as path from "path";
import { compile } from "squiffy-compiler";
import { externalFiles } from "./external-files.js";
import { createPackage } from "@textadventures/squiffy-packager";

async function getCompileResult(inputFilename: string) {
    const inputFile = fs.readFileSync(inputFilename);
    const inputText = inputFile.toString();
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

export const createPackageFiles = async (inputFilename: string, outputPath: string, createZip: boolean) => {
    console.log("Loading " + inputFilename);

    const result = await getCompileResult(inputFilename);

    if (!result.success) {
        console.log("Failed.");
        return false;
    }

    const pkg = await createPackage(result, createZip);
    const files = pkg.files;

    for (const file of Object.keys(files)) {
        console.log(`Writing ${file}`);
        fs.writeFileSync(path.join(outputPath, file), files[file]);
    }

    if (createZip && pkg.zip) {
        console.log("Writing output.zip");
        fs.writeFileSync(path.join(outputPath, "output.zip"), pkg.zip);
    }

    console.log("Done.");
    return true;
};
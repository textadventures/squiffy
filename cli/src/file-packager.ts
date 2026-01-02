import * as fs from 'fs';
import * as path from 'path';
import { compile } from 'squiffy-compiler';
import { externalFiles } from './external-files.js';
import {createPackage} from "@textadventures/squiffy-packager";

async function getCompileResult(inputFilename: string) {
    const inputFile = fs.readFileSync(inputFilename);
    const inputText = inputFile.toString();
    return await compile({
        scriptBaseFilename: path.basename(inputFilename),
        script: inputText,
        onWarning: console.warn,
        externalFiles: externalFiles(inputFilename)
    });
}

export const createPackageFiles = async (inputFilename: string) => {
    console.log('Loading ' + inputFilename);

    const result = await getCompileResult(inputFilename);

    if (!result.success) {
        console.log('Failed.');
        return;
    }

    const pkg = await createPackage(result);
    console.log(pkg);
};
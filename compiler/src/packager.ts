import * as fs from 'fs';
import * as path from 'path';
import * as compiler from './compiler.js';

export const createPackage = async (inputFilename: string) => {
    const template = fs.readFileSync(path.join(import.meta.dirname, "squiffy.template.js")).toString();
    return await compiler.generate(inputFilename, template);
}
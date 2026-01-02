// import * as fs from 'fs';
// import * as path from 'path';
// import { compile } from 'squiffy-compiler';
// import { externalFiles } from './external-files.js';

import squiffyRuntime from 'squiffy-runtime/dist/squiffy.runtime.js?raw';

import pkg from '../package.json' with { type: 'json' };
const version = pkg.version;

// async function getCompileResult(inputFilename: string) {
//     const inputFile = fs.readFileSync(inputFilename);
//     const inputText = inputFile.toString();
//     return await compile({
//         scriptBaseFilename: path.basename(inputFilename),
//         script: inputText,
//         onWarning: console.warn,
//         externalFiles: externalFiles(inputFilename)
//     });
// }

export const createPackage = async (inputFilename: string) => {
    console.log('Loading ' + inputFilename);

    console.log('temp: ' + version);

    console.log('runtime: ' + squiffyRuntime);

    // const result = await getCompileResult(inputFilename);
    //
    // if (!result.success) {
    //     console.log('Failed.');
    //     return;
    // }
    //
    // const storyJsName = /* typeof options.scriptOnly === 'string' ? options.scriptOnly : */ 'story.js';
    //
    // console.log('Writing ' + storyJsName);
    //
    // const storyJs = await result.getJs();
    //
    // const outputPath = path.resolve(path.dirname(inputFilename));
    // fs.writeFileSync(path.join(outputPath, storyJsName), storyJs);
    //
    // const uiInfo = result.getUiInfo();
    //
    // console.log('Writing squiffy.runtime.js');
    // fs.copyFileSync(path.join(import.meta.dirname, 'squiffy.runtime.js'), path.join(outputPath, 'squiffy.runtime.js'));
    //
    // console.log('Writing index.html');
    //
    // const htmlTemplateFile = fs.readFileSync(findFile('index.template.html', outputPath /*, sourcePath */));
    // let htmlData = htmlTemplateFile.toString();
    // htmlData = htmlData.replace('<!-- INFO -->', `<!--\n\nCreated with Squiffy ${version}\n\n\nhttps://github.com/textadventures/squiffy\n\n-->`);
    // htmlData = htmlData.replace('<!-- TITLE -->', uiInfo.title);
    // const scriptData = uiInfo.externalScripts.map(script => `<script src="${script}"></script>`).join('\n');
    // htmlData = htmlData.replace('<!-- SCRIPTS -->', scriptData);
    //
    // var stylesheetData = uiInfo.externalStylesheets.map(sheet => `<link rel="stylesheet" href="${sheet}"/>`).join('\n');
    // htmlData = htmlData.replace('<!-- STYLESHEETS -->', stylesheetData);
    //
    // fs.writeFileSync(path.join(outputPath, 'index.html'), htmlData);
    //
    // console.log('Writing style.css');
    // const cssTemplateFile = fs.readFileSync(findFile('style.template.css', outputPath /*, sourcePath */));
    // const cssData = cssTemplateFile.toString();
    // fs.writeFileSync(path.join(outputPath, 'style.css'), cssData);
    //
    // // if (options.zip) {
    // //     console.log('Creating zip file');
    // //     var JSZip = require('jszip');
    // //     var zip = new JSZip();
    // //     zip.file(storyJsName, storyJs);
    // //     zip.file('index.html', htmlData);
    // //     zip.file('style.css', cssData);
    // //     var buffer = zip.generate({
    // //         type: 'nodebuffer'
    // //     });
    // //     if (options.write) {
    // //         fs.writeFileSync(path.join(outputPath, 'output.zip'), buffer);
    // //     }
    // //     else {
    // //         return buffer;
    // //     }
    // // }
    //
    // console.log('Done.');
    //
    // return outputPath;
}

// function findFile(filename: string, outputPath: string /*, sourcePath: string */) {
//     if (outputPath) {
//         const outputPathFile = path.join(outputPath, filename);
//         if (fs.existsSync(outputPathFile)) {
//             return outputPathFile;
//         }
//     }
//     return path.join(import.meta.dirname, filename);
// }
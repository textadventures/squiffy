import * as fs from 'fs';
import * as path from 'path';
import { compile } from './compiler.js';
import { SQUIFFY_VERSION } from './version.js';
import { externalFiles } from './external-files.js';

export const createPackage = async (inputFilename: string) => {
    return await generate(inputFilename);
}

async function generate(inputFilename: string) {
    console.log('Loading ' + inputFilename);

    var inputFile = fs.readFileSync(inputFilename);
    var inputText = inputFile.toString();

    const result = await compile({
        scriptBaseFilename: path.basename(inputFilename),
        script: inputText,
        onWarning: console.warn,
        externalFiles: externalFiles(inputFilename)
    });

    if (!result.success) {
        console.log('Failed.');
        return;
    }

    var storyJsName = /* typeof options.scriptOnly === 'string' ? options.scriptOnly : */ 'story.js';

    console.log('Writing ' + storyJsName);

    var storyJs = await result.getJs();

    var outputPath = path.resolve(path.dirname(inputFilename));
    fs.writeFileSync(path.join(outputPath, storyJsName), storyJs);

    const uiInfo = result.getUiInfo();

    console.log('Writing squiffy.runtime.js');
    fs.copyFileSync(path.join(import.meta.dirname, 'squiffy.runtime.js'), path.join(outputPath, 'squiffy.runtime.js'));

    var cssTemplateFile = fs.readFileSync(findFile('style.template.css', outputPath /*, sourcePath */));
    var cssData = cssTemplateFile.toString();
    fs.writeFileSync(path.join(outputPath, 'style.css'), cssData);
    
    console.log('Writing index.html');

    var htmlTemplateFile = fs.readFileSync(findFile('index.template.html', outputPath /*, sourcePath */));
    var htmlData = htmlTemplateFile.toString();
    htmlData = htmlData.replace('<!-- INFO -->', `<!--\n\nCreated with Squiffy ${SQUIFFY_VERSION}\n\n\nhttps://github.com/textadventures/squiffy\n\n-->`);
    htmlData = htmlData.replace('<!-- TITLE -->', uiInfo.title);
    var scriptData = uiInfo.externalScripts.map(script => `<script src="${script}"></script>`).join('\n');
    htmlData = htmlData.replace('<!-- SCRIPTS -->', scriptData);

    var stylesheetData = uiInfo.externalStylesheets.map(sheet => `<link rel="stylesheet" href="${sheet}"/>`).join('\n');
    htmlData = htmlData.replace('<!-- STYLESHEETS -->', stylesheetData);

    fs.writeFileSync(path.join(outputPath, 'index.html'), htmlData);

    console.log('Writing style.css');
    var cssTemplateFile = fs.readFileSync(findFile('style.template.css', outputPath /*, sourcePath */));
    var cssData = cssTemplateFile.toString();
    fs.writeFileSync(path.join(outputPath, 'style.css'), cssData);

    // if (options.zip) {
    //     console.log('Creating zip file');
    //     var JSZip = require('jszip');
    //     var zip = new JSZip();
    //     zip.file(storyJsName, storyJs);
    //     zip.file('index.html', htmlData);
    //     zip.file('style.css', cssData);
    //     var buffer = zip.generate({
    //         type: 'nodebuffer'
    //     });
    //     if (options.write) {
    //         fs.writeFileSync(path.join(outputPath, 'output.zip'), buffer);
    //     }
    //     else {
    //         return buffer;
    //     }
    // }

    console.log('Done.');

    return outputPath;
};

function findFile(filename: string, outputPath: string /*, sourcePath: string */) {
    if (outputPath) {
        var outputPathFile = path.join(outputPath, filename);
        if (fs.existsSync(outputPathFile)) {
            return outputPathFile;
        }
    }
    return path.join(import.meta.dirname, filename);
};
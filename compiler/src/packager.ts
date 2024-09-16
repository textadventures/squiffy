import * as fs from 'fs';
import * as path from 'path';
import { Compiler, Story } from './compiler.js';
import { SQUIFFY_VERSION } from './version.js';

export const createPackage = async (inputFilename: string) => {
    const template = fs.readFileSync(path.join(import.meta.dirname, "squiffy.template.js")).toString();
    
    return await generate(inputFilename, template);
}

async function generate(inputFilename: string, template: string) {
    const compiler = new Compiler({
        onWarning: console.warn
    });
    
    var outputPath = path.resolve(path.dirname(inputFilename));

    var story = new Story(path.basename(inputFilename));

    var success = await processFile(compiler, story, path.resolve(inputFilename), true);

    if (!success) {
        console.log('Failed.');
        return;
    }

    var storyJsName = /* typeof options.scriptOnly === 'string' ? options.scriptOnly : */ 'story.js';

    console.log('Writing ' + storyJsName);

    var storyJs = await compiler.getJs(story, template /*, sourcePath, options */);

    fs.writeFileSync(path.join(outputPath, storyJsName), storyJs);

    // if (!options.scriptOnly) {
        console.log('Writing index.html');

        var htmlTemplateFile = fs.readFileSync(findFile('index.template.html', outputPath /*, sourcePath */));
        var htmlData = htmlTemplateFile.toString();
        htmlData = htmlData.replace('<!-- INFO -->', `<!--\n\nCreated with Squiffy ${SQUIFFY_VERSION}\n\n\nhttps://github.com/textadventures/squiffy\n\n-->`);
        htmlData = htmlData.replace('<!-- TITLE -->', story.title);
        // var jQueryPath = "";
        // if (typeof options.escritorio !== "undefined")
        //     jQueryPath = path.join(sourcePath, '..', 'jquery', 'dist', 'jquery.min.js');
        // else
        //     jQueryPath = path.join(sourcePath, 'node_modules', 'jquery', 'dist', 'jquery.min.js');
        var jqueryJs = 'jquery.min.js';
        // if (options.useCdn) {
        //     var jqueryVersion = packageJson.dependencies.jquery.match(/[0-9.]+/)[0];
        //     jqueryJs = `https://ajax.aspnetcdn.com/ajax/jquery/jquery-${jqueryVersion}.min.js`;
        // }
        // else if (options.write) {
            fs.createReadStream(path.join(import.meta.dirname, 'jquery.min.js')).pipe(fs.createWriteStream(path.join(outputPath, 'jquery.min.js')));
        // }

        htmlData = htmlData.replace('<!-- JQUERY -->', jqueryJs);

        var scriptData = story.scripts.map(script => `<script src="${script}"></script>`).join('\n');
        htmlData = htmlData.replace('<!-- SCRIPTS -->', scriptData);

        var stylesheetData = story.stylesheets.map(sheet => `<link rel="stylesheet" href="${sheet}"/>`).join('\n');
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
        //     if (!options.useCdn) {
        //         var jquery = fs.readFileSync(jQueryPath);
        //         zip.file(jqueryJs, jquery);
        //     }
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

// TODO: When handling @import, keep track of which files have been included already. Don't include them again.
async function processFile(compiler: Compiler, story: Story, inputFilename: string, isFirst: boolean) {
    console.log('Loading ' + inputFilename);

    var inputFile = fs.readFileSync(inputFilename);
    var inputText = inputFile.toString();

    return await compiler.processFileText(story, inputText, inputFilename, isFirst);
};
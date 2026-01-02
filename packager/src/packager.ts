import { CompileSuccess } from 'squiffy-compiler';

import squiffyRuntime from 'squiffy-runtime/dist/squiffy.runtime.js?raw';
import htmlTemplateFile from './index.template.html?raw';
import cssTemplateFile from './style.template.css?raw';

import pkg from '../package.json' with {type: 'json'};

const version = pkg.version;

export const createPackage = async (result: CompileSuccess) => {
    const output: Record<string, string> = {};

    output['story.js'] = await result.getJs();
    output['squiffy.runtime.js'] = squiffyRuntime;

    const uiInfo = result.getUiInfo();

    let htmlData = htmlTemplateFile.toString();
    htmlData = htmlData.replace('<!-- INFO -->', `<!--\n\nCreated with Squiffy ${version}\n\n\nhttps://github.com/textadventures/squiffy\n\n-->`);
    htmlData = htmlData.replace('<!-- TITLE -->', uiInfo.title);
    const scriptData = uiInfo.externalScripts.map(script => `<script src="${script}"></script>`).join('\n');
    htmlData = htmlData.replace('<!-- SCRIPTS -->', scriptData);

    const stylesheetData = uiInfo.externalStylesheets.map(sheet => `<link rel="stylesheet" href="${sheet}"/>`).join('\n');
    htmlData = htmlData.replace('<!-- STYLESHEETS -->', stylesheetData);

    output['index.html'] = htmlData;
    output['style.css'] = cssTemplateFile.toString();

    return output;
}
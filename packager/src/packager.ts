import { strToU8, zipSync } from "fflate";
import { CompileSuccess } from "squiffy-compiler";

import squiffyRuntime from "squiffy-runtime/dist/squiffy.runtime.global.js?raw";
import runtimeCss from "squiffy-runtime/dist/squiffy.runtime.css?raw";
import htmlTemplateFile from "./index.template.html?raw";
import cssTemplateFile from "./style.template.css?raw";

import pkg from "../package.json" with {type: "json"};

const version = pkg.version;

export interface Package {
    files: Record<string, string>;
    zip?: Uint8Array;
}

export const createPackage = async (input: CompileSuccess, createZip: boolean): Promise<Package> => {
    const output: Record<string, string> = {};

    output["story.js"] = await input.getJs();
    output["squiffy.runtime.global.js"] = squiffyRuntime;

    const uiInfo = input.getUiInfo();

    let htmlData = htmlTemplateFile.toString();
    htmlData = htmlData.replace("<!-- INFO -->", `<!--\n\nCreated with Squiffy ${version}\n\nhttps://squiffystory.com\nhttps://github.com/textadventures/squiffy\n\n-->`);
    htmlData = htmlData.replace("<!-- TITLE -->", uiInfo.title);
    const scriptData = uiInfo.externalScripts.map(script => `<script src="${script}"></script>`).join("\n");
    htmlData = htmlData.replace("<!-- SCRIPTS -->", scriptData);

    const stylesheetData = uiInfo.externalStylesheets.map(sheet => `<link rel="stylesheet" href="${sheet}"/>`).join("\n");
    htmlData = htmlData.replace("<!-- STYLESHEETS -->", stylesheetData);

    output["index.html"] = htmlData;
    // Combine runtime CSS with application-specific container styles
    output["style.css"] = runtimeCss.toString() + "\n\n" + cssTemplateFile.toString();

    return {
        files: output,
        zip: !createZip ? undefined : zipSync(
            Object.fromEntries(
                Object.entries(output).map(([name, text]) => [name, strToU8(text)])
            )
        )
    };
};
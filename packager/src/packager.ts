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

export interface PackageOptions {
    createZip?: boolean;
    inlineHtml?: boolean;
}

export const createPackage = async (input: CompileSuccess, createZipOrOptions: boolean | PackageOptions = false): Promise<Package> => {
    // Handle both old boolean signature and new options object
    const options: PackageOptions = typeof createZipOrOptions === "boolean"
        ? { createZip: createZipOrOptions }
        : createZipOrOptions;

    const output: Record<string, string> = {};
    const uiInfo = input.getUiInfo();

    const infoComment = `<!--\n\nCreated with Squiffy ${version}\n\nhttps://squiffystory.com\nhttps://github.com/textadventures/squiffy\n\n-->`;
    const scriptData = uiInfo.externalScripts.map(script => `<script src="${script}"></script>`).join("\n");
    const stylesheetData = uiInfo.externalStylesheets.map(sheet => `<link rel="stylesheet" href="${sheet}"/>`).join("\n");
    const combinedCss = runtimeCss.toString() + "\n\n" + cssTemplateFile.toString();

    const storyJs = await input.getJs();

    // Generate content for placeholders based on inline vs external mode
    // Note: We use arrow functions as replacements to prevent $-pattern interpretation
    // (e.g., $& or ${...} in the replacement string would otherwise be treated specially)
    let styleContent: string;
    let runtimeContent: string;
    let storyContent: string;

    if (options.inlineHtml) {
        // Inline everything into the HTML
        styleContent = "<style>\n" + combinedCss + "\n    </style>";
        runtimeContent = "<script>\n" + squiffyRuntime + "\n    </script>";
        storyContent = "<script>\n" + storyJs + "\n    </script>";
    } else {
        // Reference external files
        styleContent = "<link rel=\"stylesheet\" href=\"style.css\"/>";
        runtimeContent = "<script src=\"squiffy.runtime.global.js\"></script>";
        storyContent = "<script src=\"story.js\"></script>";

        output["story.js"] = storyJs;
        output["squiffy.runtime.global.js"] = squiffyRuntime;
        output["style.css"] = combinedCss;
    }

    let htmlData = htmlTemplateFile.toString();
    htmlData = htmlData.replace("<!-- INFO -->", () => infoComment);
    htmlData = htmlData.replace("<!-- TITLE -->", () => uiInfo.title);
    htmlData = htmlData.replace("<!-- SCRIPTS -->", () => scriptData);
    htmlData = htmlData.replace("<!-- STYLESHEETS -->", () => stylesheetData);
    htmlData = htmlData.replace("<!-- STYLE_CONTENT -->", () => styleContent);
    htmlData = htmlData.replace("<!-- RUNTIME_CONTENT -->", () => runtimeContent);
    htmlData = htmlData.replace("<!-- STORY_CONTENT -->", () => storyContent);

    output["index.html"] = htmlData;

    return {
        files: output,
        zip: !options.createZip ? undefined : zipSync(
            Object.fromEntries(
                Object.entries(output).map(([name, text]) => [name, strToU8(text)])
            )
        )
    };
};
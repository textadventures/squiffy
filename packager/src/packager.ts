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
    /**
     * Asset files used by the story (images, audio etc.), keyed by their path relative to the story,
     * e.g. "cat.png" or "images/cat.png". They're added to the zip at those paths. With inlineHtml,
     * they're embedded in index.html as data: URIs, which the runtime uses via its resolveAssetUrl option.
     * They're not added to Package.files, as those are text files, and the caller already has the assets.
     */
    assets?: Record<string, Uint8Array>;
}

const mimeTypes: Record<string, string> = {
    apng: "image/apng",
    avif: "image/avif",
    bmp: "image/bmp",
    gif: "image/gif",
    ico: "image/x-icon",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
    aac: "audio/aac",
    flac: "audio/flac",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    oga: "audio/ogg",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    wav: "audio/wav",
    weba: "audio/webm",
    m4v: "video/mp4",
    mp4: "video/mp4",
    ogv: "video/ogg",
    webm: "video/webm",
    vtt: "text/vtt",
    otf: "font/otf",
    ttf: "font/ttf",
    woff: "font/woff",
    woff2: "font/woff2",
    pdf: "application/pdf",
    json: "application/json",
    txt: "text/plain",
};

export const getMimeType = (path: string) =>
    mimeTypes[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

// Normalises an asset path to the form the runtime will see it in story output, e.g. "./images\\cat.png" -> "images/cat.png".
// Throws for paths that would end up outside the package.
export const normaliseAssetPath = (path: string) => {
    const normalised = path.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
    if (!normalised || normalised.startsWith("/") || /^[a-z]:/i.test(normalised) || normalised.split("/").includes("..")) {
        throw new Error(`Invalid asset path: ${path}`);
    }
    return normalised;
};

const toBase64 = (bytes: Uint8Array) => {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
};

// Escapes JSON so that it's safe inside a <script> element.
const scriptSafeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

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

    const assets: Record<string, Uint8Array> = {};
    for (const [path, bytes] of Object.entries(options.assets ?? {})) {
        assets[normaliseAssetPath(path)] = bytes;
    }
    const hasAssets = Object.keys(assets).length > 0;
    let assetOptions = "";

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

        if (hasAssets) {
            // A single-file export can't refer to separate asset files, so embed them as data: URIs.
            const dataUris = Object.fromEntries(Object.entries(assets).map(([path, bytes]) =>
                [path, `data:${getMimeType(path)};base64,${toBase64(bytes)}`]));
            storyContent += "\n    <script>\nvar squiffyAssetUrls = " + scriptSafeJson(dataUris) + ";\n    </script>";
            assetOptions = "resolveAssetUrl: function (path) { return squiffyAssetUrls[path.replace(/^(\\.\\/)+/, \"\")] || path; },";
        }
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
    htmlData = htmlData.replace(/\n([ \t]*)\/\* ASSET_OPTIONS \*\//, (_, indent: string) => assetOptions ? "\n" + indent + assetOptions : "");

    output["index.html"] = htmlData;

    return {
        files: output,
        zip: !options.createZip ? undefined : zipSync({
            // Assets are already embedded in index.html when inlining
            ...(options.inlineHtml ? {} : assets),
            // Generated files take precedence over any asset with the same name
            ...Object.fromEntries(
                Object.entries(output).map(([name, text]) => [name, strToU8(text)])
            )
        })
    };
};
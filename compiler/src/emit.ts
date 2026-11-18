import pkg from "../package.json" with { type: "json" };
import { Analysis, analysisInternals } from "./analyse.js";
import type { Diagnostic } from "./syntax.js";

const version = pkg.version;

export interface Output {
    story: OutputStory;
    js: string[][];
}

interface OutputStory {
    start: string;
    id: string | null;
    // squiffy.json's "id", which a saved game is checked against
    projectId?: string;
    uiJsIndex?: number;
    // Whether @set and link setters take expressions (#373)
    expressions?: boolean;
    sections: Record<string, OutputSection>;
}

interface OutputSection {
    text?: string;
    clear?: boolean;
    attributes?: string[];
    jsIndex?: number;
    passages?: Record<string, OutputPassage>;
    passageCount?: number;
}

interface OutputPassage {
    text?: string;
    clear?: boolean;
    attributes?: string[];
    jsIndex?: number;
}

export interface UiInfo {
    title: string;
    externalScripts: string[];
    externalStylesheets: string[];
}

export interface EmitSettings {
    // Declare the story as a global variable instead of exporting it from a module.
    globalJs?: boolean;
    // squiffy.json's "id", if the story has one: see ProjectFile.id
    projectId?: string;
}

export interface CompileSuccess {
    success: true;
    output: Output;
    getJs: (excludeHeader?: boolean) => Promise<string>;
    getUiInfo: () => UiInfo;
    // Warnings from analysing the story
    diagnostics: Diagnostic[];
}

// Produces the story data and JavaScript for an analysis that succeeded.
export function emit(analysis: Analysis, settings: EmitSettings = {}): CompileSuccess {
    const internals = analysisInternals.get(analysis);
    if (!internals) {
        throw new Error("emit() needs the result of analyse()");
    }
    if (!analysis.success) {
        throw new Error("Can't emit a story whose analysis has errors");
    }
    const story = internals.story;

    const output: Output = {
        story: {
            start: story.start,
            id: story.id,
            sections: {},
        },
        js: [],
    };

    if (analysis.expressions) {
        output.story.expressions = true;
    }

    if (settings.projectId) {
        output.story.projectId = settings.projectId;
    }

    if (story.uiJs.length > 0) {
        output.js.push(story.uiJs);
        output.story.uiJsIndex = output.js.length - 1;
    }

    for (const sectionName of Object.keys(story.sections)) {
        const section = story.sections[sectionName];
        const outputSection: OutputSection = {};
        output.story.sections[sectionName] = outputSection;

        if (section.clear) {
            outputSection.clear = true;
        }

        outputSection.text = section.output;

        if (section.attributes.length > 0) {
            outputSection.attributes = section.attributes;
        }
        if (section.js.length > 0) {
            output.js.push(section.js);
            outputSection.jsIndex = output.js.length - 1;
        }
        if ("@last" in section.passages) {
            let passageCount = 0;
            for (const passageName of Object.keys(section.passages)) {
                if (passageName.length > 0 && passageName?.substring(0, 1) !== "@") {
                    passageCount++;
                }
            }
            outputSection.passageCount = passageCount;
        }

        if (Object.keys(section.passages).length == 0) continue;

        outputSection.passages = {};

        for (const passageName of Object.keys(section.passages)) {
            const passage = section.passages[passageName];
            const outputPassage: OutputPassage = {};
            outputSection.passages[passageName] = outputPassage;

            if (passage.clear) {
                outputPassage.clear = true;
            }

            outputPassage.text = passage.output;

            if (passage.attributes.length > 0) {
                outputPassage.attributes = passage.attributes;
            }
            if (passage.js.length > 0) {
                output.js.push(passage.js);
                outputPassage.jsIndex = output.js.length - 1;
            }
        }
    }

    const getJs = async (excludeHeader: boolean) => {
        const outputJs: string[] = [];
        if (!excludeHeader) {
            outputJs.push(`// Created with Squiffy ${version}`);
            outputJs.push("// https://github.com/textadventures/squiffy");
        }
        if (settings.globalJs) {
            outputJs.push("var story = {};");
        }
        else {
            outputJs.push("export const story = {};");
        }
        outputJs.push(`story.id = ${JSON.stringify(output.story.id, null, 4)};`);
        if (output.story.projectId) {
            outputJs.push(`story.projectId = ${JSON.stringify(output.story.projectId)};`);
        }
        if (output.story.uiJsIndex !== undefined) {
            outputJs.push(`story.uiJsIndex = ${output.story.uiJsIndex};`);
        }
        if (output.story.expressions) {
            outputJs.push("story.expressions = true;");
        }
        outputJs.push(`story.start = ${JSON.stringify(output.story.start, null, 4)};`);
        outputJs.push(`story.sections = ${JSON.stringify(output.story.sections, null, 4)};`);
        outputJs.push("story.js = [");
        for (const js of output.js) {
            writeJs(outputJs, 1, js);
        }
        outputJs.push("];");

        return outputJs.join("\n");
    };

    return {
        success: true,
        output,
        getJs: (excludeHeader?: boolean) => getJs(excludeHeader || false),
        getUiInfo: () => ({
            title: story.title,
            externalScripts: story.scripts,
            externalStylesheets: story.stylesheets,
        }),
        diagnostics: analysis.diagnostics,
    };
}

function writeJs(outputJsFile: string[], tabCount: number, js: string[]) {
    const tabs = new Array(tabCount + 1).join("\t");
    outputJsFile.push(`${tabs}(squiffy, get, set) => {`);
    for (const jsLine of js) {
        outputJsFile.push(`${tabs}\t${jsLine}`);
    }
    outputJsFile.push(`${tabs}},`);
}

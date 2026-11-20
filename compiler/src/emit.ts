import pkg from "../package.json" with { type: "json" };
import { Analysis, analysisInternals } from "./analyse.js";
import type { Diagnostic } from "./syntax.js";
import type { Panel, PlayerSetting } from "./project.js";

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
    // squiffy.json's "panels"
    panels?: Panel[];
    // squiffy.json's "settings"
    settings?: PlayerSetting[];
    sections: Record<string, OutputSection>;
    // The sound files the story names (#444), from @music, @sound and {{music}} and {{sound}}
    // with a file in quotes, so the runtime can load them before they're needed
    audio?: string[];
}

interface OutputSection {
    text?: string;
    clear?: boolean;
    // @music (#444): the file to play, or null to stop it
    music?: string | null;
    // @sound: files to play once, in order, with "stop" for @sound stop, which stops the sounds playing
    sounds?: string[];
    // @class (#449): classes on the story's element while this is the current section
    classes?: string[];
    // @transition (#489): how it appears, or "none", and how long that takes in milliseconds
    transition?: string;
    transitionTime?: number;
    attributes?: string[];
    jsIndex?: number;
    passages?: Record<string, OutputPassage>;
    passageCount?: number;
}

interface OutputPassage {
    text?: string;
    clear?: boolean;
    // @music (#444): the file to play, or null to stop it
    music?: string | null;
    // @sound: files to play once, in order, with "stop" for @sound stop, which stops the sounds playing
    sounds?: string[];
    // @class (#449): classes added to the section's when this passage is shown
    classes?: string[];
    // @transition (#489): how it appears, or "none", and how long that takes in milliseconds
    transition?: string;
    transitionTime?: number;
    // Its links aren't disabled when clicked (#104)
    repeat?: boolean;
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
    // squiffy.json's "panels", if it has any: see ProjectFile.panels
    panels?: Panel[];
    // squiffy.json's "settings", if it has any: see ProjectFile.settings
    settings?: PlayerSetting[];
}

export interface CompileSuccess {
    success: true;
    output: Output;
    getJs: (excludeHeader?: boolean) => Promise<string>;
    getUiInfo: () => UiInfo;
    // Warnings from analysing the story
    diagnostics: Diagnostic[];
}

// {{music "file"}} or {{sound "file"}}
const SOUND_HELPER = /\{\{\s*(?:music|sound)\s+(["'])([^"'{}]+)\1/g;

// @music and @sound (#444), and the files they and the text name, for OutputStory.audio
function addSounds(output: OutputSection | OutputPassage, from: { music?: string | null; sounds: string[]; output: string }, audio: Set<string>) {
    if (from.music !== undefined) output.music = from.music;
    if (from.sounds.length) output.sounds = from.sounds;
    if (from.music) audio.add(from.music);
    from.sounds.forEach(file => { if (file != "stop") audio.add(file); });
    for (const match of from.output.matchAll(SOUND_HELPER)) audio.add(match[2]);
}

function addTransition(output: OutputSection | OutputPassage, from: { transition?: string; transitionTime?: number }) {
    if (from.transition !== undefined) output.transition = from.transition;
    if (from.transitionTime !== undefined) output.transitionTime = from.transitionTime;
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

    if (settings.panels?.length) {
        output.story.panels = settings.panels;
    }

    if (settings.settings?.length) {
        output.story.settings = settings.settings;
    }

    if (story.uiJs.length > 0) {
        output.js.push(story.uiJs);
        output.story.uiJsIndex = output.js.length - 1;
    }

    const audio = new Set<string>();
    for (const sectionName of Object.keys(story.sections)) {
        const section = story.sections[sectionName];
        const outputSection: OutputSection = {};
        output.story.sections[sectionName] = outputSection;

        if (section.clear) {
            outputSection.clear = true;
        }

        outputSection.text = section.output;
        addSounds(outputSection, section, audio);
        if (section.classes.length) outputSection.classes = section.classes;
        addTransition(outputSection, section);

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
                // A passage with @repeat doesn't count, as clicking it doesn't use it up
                if (passageName.length > 0 && passageName?.substring(0, 1) !== "@" && !section.passages[passageName].repeat) {
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
            if (passage.repeat) {
                outputPassage.repeat = true;
            }

            outputPassage.text = passage.output;
            addSounds(outputPassage, passage, audio);
            if (passage.classes.length) outputPassage.classes = passage.classes;
            addTransition(outputPassage, passage);

            if (passage.attributes.length > 0) {
                outputPassage.attributes = passage.attributes;
            }
            if (passage.js.length > 0) {
                output.js.push(passage.js);
                outputPassage.jsIndex = output.js.length - 1;
            }
        }
    }

    if (audio.size) {
        output.story.audio = [...audio];
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
        if (output.story.panels) {
            outputJs.push(`story.panels = ${JSON.stringify(output.story.panels, null, 4)};`);
        }
        if (output.story.settings) {
            outputJs.push(`story.settings = ${JSON.stringify(output.story.settings, null, 4)};`);
        }
        if (output.story.audio) {
            outputJs.push(`story.audio = ${JSON.stringify(output.story.audio, null, 4)};`);
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

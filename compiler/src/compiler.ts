import { analyse, analysisInternals, ExternalFiles, ParseCache } from "./analyse.js";
import { emit, CompileSuccess } from "./emit.js";
import type { Diagnostic } from "./syntax.js";
import type { Panel, PlayerSetting } from "./project.js";

export { findV5Syntax, convertV5Syntax } from "./v5.js";
export type { V5SyntaxMatch, V5ConversionProblem, V5ConversionResult } from "./v5.js";
export { convertSetters, convertSetter } from "./setters.js";
export { convertTwine, convertTwineStory, formatTwineProblems } from "./twine/convert.js";
export type { TwineConversionResult, TwineConversionProblem, TwineConversionOptions } from "./twine/convert.js";
export { parseTwine, isTwineSource, TwineParseError } from "./twine/story.js";
export type { TwineStory, TwinePassage } from "./twine/story.js";
export { convertQuestGamebook, formatQuestProblems } from "./quest/convert.js";
export type { QuestConversionResult, QuestConversionProblem, QuestConversionOptions } from "./quest/convert.js";
export { isQuestSource, QuestParseError } from "./quest/aslx.js";
export type { SetterConversion, SetterConversionProblem, SetterConversionResult } from "./setters.js";

// The compiler works in three stages, which can also be used separately:
// - parse() turns one file into a syntax tree, with a source range on every node
// - analyse() resolves @imports, builds the story's sections and passages, and reports diagnostics
// - emit() turns a successful analysis into the story data and JavaScript the runtime needs
export { parse } from "./parse.js";
export { analyse, ParseCache } from "./analyse.js";
export type { AnalyseSettings, Analysis, ExternalFiles, SectionSymbol, PassageSymbol } from "./analyse.js";
export { emit } from "./emit.js";
export type { EmitSettings, Output, UiInfo, CompileSuccess } from "./emit.js";
export { formatDiagnostic } from "./syntax.js";
export { BUILT_IN_HELPERS } from "./helpers.js";
export { findCssUrls, isRelativeUrl, resolveCssUrl, rewriteCssUrls } from "./css-urls.js";
export {
    PROJECT_FILENAME, PROJECT_FILE_VERSION, PROJECT_SCHEMA_URL, parseProjectFile, getStoryFiles, isExcluded,
    isAlwaysSkipped, formatProjectFile, updateProjectFile, PAGE_STRINGS, PANEL_ICONS, PLAYER_SETTING_TYPES, storyFileList, BUILD_FOLDER,
} from "./project.js";
export type { MapPositions, PageStringName, PageStrings, Panel, PanelIcon, PlayerSetting, PlayerSettingOption, ProjectFile, ParsedProjectFile, StoryFiles } from "./project.js";
export type * from "./syntax.js";

interface CompilerSettings {
    scriptBaseFilename?: string;
    script: string;
    // Called with each warning, formatted as a string. Link warnings give the line of the
    // section or passage the link is in; the diagnostics in the result give the link's own line.
    onWarning?: (message: string) => void;
    externalFiles?: ExternalFiles;
    globalJs?: boolean;
    parseCache?: ParseCache;
    // In folder mode, the story's other files: see AnalyseSettings.storyFiles
    storyFiles?: string[];
    // Whether @set and link setters take expressions: see AnalyseSettings.expressions
    expressions?: boolean;
    // squiffy.json's "id": see EmitSettings.projectId
    projectId?: string;
    // squiffy.json's "panels": see EmitSettings.panels
    panels?: Panel[];
    // squiffy.json's "settings": see EmitSettings.settings
    settings?: PlayerSetting[];
    // squiffy.json's "persistent": see EmitSettings.persistent
    persistent?: string[];
}

export interface CompileError {
    success: false;
    // The first error, formatted as a string
    errors: string[];
    // The error and any warnings before it
    diagnostics: Diagnostic[];
}

export async function compile(settings: CompilerSettings): Promise<CompileSuccess | CompileError> {
    const analysis = await analyse(settings);
    const { legacyErrors, legacyWarnings } = analysisInternals.get(analysis)!;

    if (settings.onWarning) {
        for (const warning of legacyWarnings) {
            settings.onWarning(warning);
        }
    }

    if (!analysis.success) {
        return {
            success: false,
            errors: legacyErrors,
            diagnostics: analysis.diagnostics,
        };
    }

    return emit(analysis, { globalJs: settings.globalJs, projectId: settings.projectId, panels: settings.panels, settings: settings.settings, persistent: settings.persistent });
}

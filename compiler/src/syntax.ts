// The syntax tree that parse() returns for one .squiffy file, and the structured diagnostics
// that analyse() reports. Positions are zero-based and ranges are end-exclusive, following
// LSP conventions, so a language server can pass them straight through.

export interface Position {
    line: number;
    character: number;
}

export interface Range {
    start: Position;
    end: Position;
}

// A hint points out something that works but could be simpler, such as an @import that isn't
// needed. Hints aren't passed to the compiler's onWarning.
export type DiagnosticSeverity = "error" | "warning" | "hint";

export type DiagnosticCode =
    | "squiffy/passage-without-section"
    | "squiffy/text-in-ui-block"
    | "squiffy/content-before-section"
    | "squiffy/v5-syntax"
    | "squiffy/at-attribute"
    | "squiffy/unquoted-text"
    | "squiffy/built-in-attribute"
    | "squiffy/external-files-unavailable"
    | "squiffy/no-next-section"
    | "squiffy/unknown-embed"
    | "squiffy/unknown-goto"
    | "squiffy/unknown-deactivate"
    | "squiffy/unknown-section-link"
    | "squiffy/unknown-passage-link"
    | "squiffy/duplicate-section"
    | "squiffy/duplicate-passage"
    | "squiffy/not-in-main-file"
    | "squiffy/repeat-not-in-passage"
    | "squiffy/transition"
    | "squiffy/redundant-import"
    | "squiffy/project-file"
    | "squiffy/unreachable-section"
    | "squiffy/dead-end";

export interface Diagnostic {
    // The filename as the compiler was given it (scriptBaseFilename, or the name returned by
    // ExternalFiles.getMatchingFilenames for an imported file), or "" if there wasn't one.
    file: string;
    range: Range;
    severity: DiagnosticSeverity;
    code: DiagnosticCode;
    message: string;
}

// Formats a diagnostic the way the compiler has always reported problems, e.g.
// `WARNING: story.squiffy line 12: In section 'start' there is a link to ...`
export function formatDiagnostic(diagnostic: Diagnostic): string {
    return `${diagnostic.severity.toUpperCase()}: ${diagnostic.file} line ${diagnostic.range.start.line + 1}: ${diagnostic.message}`;
}

// ---- Syntax tree ----

export interface SquiffyFile {
    type: "file";
    filename: string | undefined;
    range: Range;
    // Everything before the first section header. In the story's main file, any content here
    // becomes the "_default" section.
    preamble: SectionNode;
    // Sections and snippets, in file order.
    sections: (SectionNode | SnippetNode)[];
}

export interface SectionNode {
    type: "section";
    // "named": [[name]]:
    // "continue": a +++ line, which starts an automatically named section
    // "separator": a --- line, which starts an automatically named section
    // "preamble": the content before the first section header (see SquiffyFile.preamble)
    kind: "named" | "continue" | "separator" | "preamble";
    // Only for "named" sections. Other sections get their names (_default, _continue1, ...)
    // when the story is analysed.
    name?: string;
    nameRange?: Range;
    // The header line ([[name]]:, +++ or ---). Missing for the preamble.
    header?: SectionHeaderNode | ContinueNode | SeparatorNode;
    range: Range;
    body: StatementNode[];
    passages: PassageNode[];
    // Links, embeds and gotos in the section's own text (not in its passages).
    links: LinkNode[];
    embeds: EmbedNode[];
    gotos: GotoNode[];
    deactivates: DeactivateNode[];
}

export interface PassageNode {
    type: "passage";
    name: string;
    nameRange: Range;
    header: PassageHeaderNode;
    range: Range;
    body: StatementNode[];
    links: LinkNode[];
    embeds: EmbedNode[];
    gotos: GotoNode[];
    deactivates: DeactivateNode[];
}

// [snippet: name]: blocks run until the next section header. Their content isn't compiled.
export interface SnippetNode {
    type: "snippet";
    name: string;
    nameRange: Range;
    header: SnippetHeaderNode;
    range: Range;
    // The lines after the header, joined with "\n".
    content: string;
}

export interface SectionHeaderNode {
    type: "section-header";
    name: string;
    range: Range;
}

export interface PassageHeaderNode {
    type: "passage-header";
    name: string;
    range: Range;
}

export interface SnippetHeaderNode {
    type: "snippet-header";
    name: string;
    range: Range;
}

// +++ or +++Link text
export interface ContinueNode {
    type: "continue";
    // The link text after +++, if any. The link defaults to "Continue...".
    text: string;
    range: Range;
}

// ---
export interface SeparatorNode {
    type: "separator";
    range: Range;
}

export interface TitleNode {
    type: "title";
    value: string;
    valueRange: Range;
    range: Range;
}

export interface StartNode {
    type: "start";
    value: string;
    valueRange: Range;
    range: Range;
}

export interface ImportNode {
    type: "import";
    pattern: string;
    patternRange: Range;
    range: Range;
}

// A line that is just "@ui": following JavaScript lines go into the UI script, until ---.
export interface UiBlockStartNode {
    type: "ui-block-start";
    range: Range;
}

// @ui filename
export interface UiFileNode {
    type: "ui-file";
    path: string;
    pathRange: Range;
    range: Range;
}

export interface ClearNode {
    type: "clear";
    range: Range;
}

// @repeat: the passage's links stay clickable, so the player can see it again (#104)
export interface RepeatNode {
    type: "repeat";
    range: Range;
}

// @end: the section is one of the story's endings, so having no way out isn't a mistake.
// The runtime ignores it.
export interface EndNode {
    type: "end";
    range: Range;
}

// @music file, @music stop, @sound file or @sound stop (#444)
export interface SoundNode {
    type: "sound";
    directive: "music" | "sound";
    // The file, or "stop" for @music stop or @sound stop
    value: string;
    valueRange: Range;
    range: Range;
}

// @class night forest (#449): classes on the story's element while this section is the current
// one. In a passage, they're added to the section's when the passage is shown.
export interface ClassNode {
    type: "class";
    // The class names, separated by spaces
    value: string;
    valueRange: Range;
    range: Range;
}

// @transition fade 1s (#489): how the section or passage appears. "none" turns off one
// that the master section sets.
export interface TransitionNode {
    type: "transition";
    // The transition's name, which is also its class in the stylesheet
    value: string;
    valueRange: Range;
    // How long it takes, such as "1s" or "400ms", if given
    time?: string;
    range: Range;
}

// @set, @unset, @inc or @dec
export interface AttributeNode {
    type: "attribute";
    directive: "set" | "unset" | "inc" | "dec";
    // For @set and @unset, everything after the directive. For @inc and @dec, the attribute name.
    value: string;
    valueRange: Range;
    // For @inc and @dec, the amount if one was given.
    amount?: string;
    range: Range;
}

// A JavaScript line: indented with a tab or four spaces, before any text in the section or passage.
export interface JsNode {
    type: "js";
    code: string;
    codeRange: Range;
    range: Range;
}

// A line of story text. Links and embeds are on the section or passage that contains it,
// since a link can span lines.
export interface TextNode {
    type: "text";
    text: string;
    range: Range;
}

// A line inside a section or passage. A separator only appears here when it doesn't start a
// new section, i.e. before the first section header.
export type StatementNode =
    | SeparatorNode
    | TitleNode
    | StartNode
    | ImportNode
    | UiBlockStartNode
    | UiFileNode
    | ClearNode
    | RepeatNode
    | EndNode
    | AttributeNode
    | SoundNode
    | ClassNode
    | TransitionNode
    | JsNode
    | TextNode;

export interface LinkNode {
    type: "link";
    // "section" for [[...]] links, "passage" for [...] links.
    linkType: "section" | "passage";
    // "named": [[text]](target) or [text](target)
    // "unnamed": [[target]] or [target]
    // "next": [[text>]] or [[text]](>), linking to the next section in the story
    // "input": <input data-section="target"> or <input data-passage="target">, a text box that
    // goes there when Enter is pressed (#454)
    form: "named" | "unnamed" | "next" | "input";
    // The link text, for named and next links.
    text?: string;
    // The target as written, including any ", attribute=value" setters, e.g. "kitchen, seen=1".
    // An input link's target has no setters.
    // For next links this is just the setters part (empty if there are none), since the
    // target section is only known when the story is analysed.
    target: string;
    range: Range;
    targetRange: Range;
}

// {{embed "name"}} with a literal name
export interface EmbedNode {
    type: "embed";
    name: string;
    range: Range;
    nameRange: Range;
}

// {{deactivate "name"}} with a literal name (#13)
export interface DeactivateNode {
    type: "deactivate";
    name: string;
    range: Range;
    nameRange: Range;
}

// {{goto "name"}} with a literal name (#375)
export interface GotoNode {
    type: "goto";
    name: string;
    range: Range;
    nameRange: Range;
}

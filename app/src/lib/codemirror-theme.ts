import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// From Quest Viva's AppShell. Built entirely from Skeleton's paired light/dark CSS custom properties (e.g.
// --color-surface-200-800, which resolves via light-dark() in
// @skeletonlabs/skeleton/src/base/theme.css) rather than a separate CodeMirror
// theme package, so the editor tracks the app's light/dark mode automatically
// and stays consistent with every other panel. Bare single-shade colors
// (e.g. --color-primary-500 alone) are unsafe for backgrounds, so only use
// them for accents/text against the paired surface background below.
// A lint gutter icon, as a mask: the path's even-odd fill cuts the symbol out of the shape
function lintIcon(path: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path fill-rule="evenodd" d="${path}"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export const editorTheme = EditorView.theme({
    "&": {
        backgroundColor: "var(--color-surface-50-950)",
        color: "var(--color-surface-900-100)",
        fontSize: "var(--editor-font-size, 14px)",
        // The Find and Go to line panels (@textadventures/editor-search)
        "--ed-search-bg": "var(--color-surface-100-900)",
        "--ed-search-border": "var(--color-surface-300-700)",
        "--ed-search-field-bg": "var(--color-surface-50-950)",
        "--ed-search-muted": "var(--color-surface-600-400)",
        "--ed-search-accent": "var(--color-primary-500)",
        "--ed-search-accent-fg": "var(--color-primary-contrast-500)",
        "--ed-search-error": "var(--color-error-500)",
    },
    ".cm-content, .cm-gutters": {
        // Quest Viva uses text-xs for short scripts; a whole story reads better a size up
        lineHeight: "1.6",
    },
    ".cm-content": {
        caretColor: "var(--color-primary-500)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--color-primary-500)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "color-mix(in srgb, var(--color-primary-500) 25%, transparent)",
    },
    ".cm-activeLine": {
        backgroundColor: "color-mix(in srgb, var(--color-surface-600-400) 10%, transparent)",
    },
    ".cm-gutters": {
        backgroundColor: "var(--color-surface-50-950)",
        color: "var(--color-surface-600-400)",
        border: "none",
        borderRight: "1px solid var(--color-surface-200-800)",
    },
    ".cm-activeLineGutter": {
        backgroundColor: "color-mix(in srgb, var(--color-surface-600-400) 10%, transparent)",
    },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
        backgroundColor: "color-mix(in srgb, var(--color-primary-500) 20%, transparent)",
        outline: "none",
    },
    // Problems, e.g. a link to a section that doesn't exist (#173): a tint as well as the wavy
    // underline, which a link's own underline would otherwise hide
    ".cm-lintRange-warning": {
        backgroundColor: "color-mix(in srgb, var(--color-warning-500) 15%, transparent)",
    },
    ".cm-lintRange-error": {
        backgroundColor: "color-mix(in srgb, var(--color-error-500) 15%, transparent)",
    },
    ".cm-lintRange-warning *, .cm-lintRange-error *": {
        textDecoration: "none",
    },
    // Fold markers (foldMarker in codemirror-folding.ts): a line high, so the chevron centres on
    // the first line of a wrapped one
    ".cm-foldGutter .cm-gutterElement": {
        display: "flex",
        justifyContent: "center",
    },
    ".cm-foldMarker": {
        display: "inline-flex",
        alignItems: "center",
        height: "1.6em",
        padding: "0 2px",
        cursor: "pointer",
    },
    ".cm-foldMarker svg": {
        width: "0.85em",
        height: "0.85em",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2.5",
        strokeLinecap: "round",
        strokeLinejoin: "round",
    },
    ".cm-foldMarker:hover": {
        color: "var(--color-surface-950-50)",
    },
    // The lint gutter's markers. @codemirror/lint draws them in pale pastels (a #fe8 triangle for a
    // warning), too faint against a light background. These are solid shapes with the symbol cut
    // out, drawn with a mask so they take the theme's colours: warning-700 on light (about 3.7:1
    // against white, over the 3:1 WCAG asks of an icon) and warning-300 on dark.
    ".cm-lint-marker": {
        content: "none",
        backgroundColor: "currentColor",
        maskRepeat: "no-repeat",
        maskPosition: "center",
        maskSize: "contain",
    },
    ".cm-lint-marker-warning": {
        content: "none",
        color: "var(--color-warning-700-300)",
        maskImage: lintIcon("M20 3 L38 36 L2 36 Z M18 13 h4 v13 h-4 Z M18 29 h4 v4 h-4 Z"),
    },
    ".cm-lint-marker-error": {
        content: "none",
        color: "var(--color-error-600-400)",
        maskImage: lintIcon("M20 2 A18 18 0 1 1 20 38 A18 18 0 1 1 20 2 Z M18 9 h4 v15 h-4 Z M18 27 h4 v4 h-4 Z"),
    },
    ".cm-lint-marker-info": {
        content: "none",
        color: "var(--color-primary-600-400)",
        maskImage: lintIcon("M20 2 A18 18 0 1 1 20 38 A18 18 0 1 1 20 2 Z M18 16 h4 v15 h-4 Z M18 9 h4 v4 h-4 Z"),
    },
    // The problem tooltip: the stripe in the theme's colours, and its fix buttons (e.g. "Mark this
    // section as an ending") as the app's buttons, with a bit more room to hit
    ".cm-diagnostic-warning": {
        borderLeftColor: "var(--color-warning-700-300)",
    },
    ".cm-diagnostic-error": {
        borderLeftColor: "var(--color-error-600-400)",
    },
    ".cm-diagnostic": {
        padding: "6px 8px 6px 10px",
    },
    ".cm-diagnosticAction": {
        backgroundColor: "var(--color-primary-500)",
        color: "var(--color-primary-contrast-500)",
        padding: "3px 10px",
        borderRadius: "4px",
    },
    ".cm-diagnosticAction:hover": {
        filter: "brightness(1.1)",
    },
    ".cm-tooltip": {
        backgroundColor: "var(--color-surface-50-950)",
        color: "var(--color-surface-900-100)",
        border: "1px solid var(--color-surface-200-800)",
    },
    ".cm-panels": {
        backgroundColor: "var(--color-surface-100-900)",
        color: "var(--color-surface-900-100)",
    },
}, { dark: false });

export const squiffyHighlightStyle = HighlightStyle.define([
    { tag: t.keyword, color: "var(--color-primary-500)", fontWeight: "bold" },
    { tag: [t.string, t.attributeValue], color: "var(--color-success-600-400)" },
    { tag: t.comment, color: "var(--color-surface-600-400)", fontStyle: "italic" },
    { tag: t.number, color: "var(--color-tertiary-500)" },
    { tag: [t.tagName, t.attributeName], color: "var(--color-primary-500)" },
    { tag: [t.bracket, t.paren, t.squareBracket, t.brace], color: "var(--color-surface-600-400)" },
    // CSS and JavaScript files (@codemirror/lang-css, @codemirror/lang-javascript). Keywords, strings,
    // comments, numbers and brackets are covered above.
    { tag: [t.atom, t.bool, t.null, t.unit, t.color, t.escape], color: "var(--color-tertiary-600-400)" },
    { tag: [t.className, t.labelName, t.typeName, t.namespace], color: "var(--color-primary-600-400)" },
    { tag: t.propertyName, color: "var(--color-secondary-600-400)" },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--color-primary-700-300)" },
    { tag: t.definition(t.variableName), color: "var(--color-surface-950-50)" },
    { tag: [t.punctuation, t.meta], color: "var(--color-surface-600-400)" },
    // Squiffy (@textadventures/squiffy-codemirror): section and passage headers, links, the text processor, and
    // indented JavaScript
    { tag: t.heading, color: "var(--color-primary-600-400)", fontWeight: "bold" },
    { tag: t.heading2, color: "var(--color-secondary-600-400)", fontWeight: "bold" },
    { tag: t.link, color: "var(--color-primary-600-400)", textDecoration: "underline" },
    { tag: t.processingInstruction, color: "var(--color-tertiary-600-400)" },
    { tag: t.monospace, color: "var(--color-surface-700-300)" },
]);

export const editorExtensions = [
    editorTheme,
    syntaxHighlighting(squiffyHighlightStyle),
];


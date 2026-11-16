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
export const editorTheme = EditorView.theme({
    "&": {
        backgroundColor: "var(--color-surface-50-950)",
        color: "var(--color-surface-900-100)",
        fontSize: "var(--editor-font-size, 14px)",
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
    // Squiffy (squiffy-lang.ts): section and passage headers, links, the text processor, and
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


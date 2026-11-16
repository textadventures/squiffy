import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { highlightTree, tagHighlighter, tags as t } from "@lezer/highlight";
import { describe, expect, test } from "vitest";
import { squiffyLanguage } from "./squiffy-lang.js";

const highlighter = tagHighlighter(Object.entries({
    heading: t.heading, heading2: t.heading2, link: t.link, keyword: t.keyword, monospace: t.monospace,
    processingInstruction: t.processingInstruction, tagName: t.tagName, comment: t.comment,
}).map(([name, tag]) => ({ tag, class: `tok-${name}` })));

// The highlighted spans of a document, as "text: tok-<tag>"
function highlight(doc: string): string[] {
    const state = EditorState.create({ doc, extensions: [squiffyLanguage] });
    const tree = ensureSyntaxTree(state, doc.length, 5000)!;
    const spans: string[] = [];
    highlightTree(tree, highlighter, (from, to, classes) => {
        spans.push(`${doc.slice(from, to)}: ${classes}`);
    });
    return spans;
}

describe("squiffy-lang", () => {
    test("indented lines are JavaScript only before a block's first line of text", () => {
        const spans = highlight("[[a]]:\n@set x = 1\n\n    js();\nText\n    not js\n[b]:\n    js2();");
        expect(spans).toContain("    js();: tok-monospace");
        expect(spans).toContain("    js2();: tok-monospace");
        expect(spans.some(s => s.startsWith("    not js"))).toBe(false);
    });

    test("text in a @ui block doesn't end its JavaScript", () => {
        const spans = highlight("@ui\n<div>hi</div>\n    js();\n---\nText\n    not js");
        expect(spans).toContain("    js();: tok-monospace");
        expect(spans.some(s => s.startsWith("    not js"))).toBe(false);
    });

    test("handlebars", () => {
        expect(highlight("You have {{score}} points.")).toContain("{{score}}: tok-processingInstruction");
        expect(highlight("{{#if a > 1}}yes{{/if}}")).toEqual([
            "{{#if a > 1}}: tok-processingInstruction",
            "{{/if}}: tok-processingInstruction",
        ]);
        expect(highlight("{{{html}}}")).toContain("{{{html}}}: tok-processingInstruction");
        expect(highlight("{{! a note }}")).toContain("{{! a note }}: tok-comment");
    });
});

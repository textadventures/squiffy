import { readFileSync } from "node:fs";
import { createHighlighter } from "shiki";
import { beforeAll, describe, expect, test } from "vitest";

// The TextMate grammar (syntaxes/squiffy.tmLanguage.json), as Shiki runs it on the docs site.
// VS Code uses the same engine, vscode-textmate.

const grammar = JSON.parse(readFileSync(new URL("../syntaxes/squiffy.tmLanguage.json", import.meta.url), "utf8"));
const sample = readFileSync(new URL("../syntaxes/samples/everything.squiffy", import.meta.url), "utf8");

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;
let highlighter: Highlighter;

beforeAll(async () => {
    highlighter = await createHighlighter({
        themes: ["github-light"],
        langs: ["javascript", { ...grammar, name: "squiffy", embeddedLangs: ["javascript"] }],
    });
});

// Each line as "text" → innermost scope, for every span of text with its own scopes.
function scopes(code: string) {
    return highlighter.codeToTokensBase(code, { lang: "squiffy", theme: "github-light", includeExplanation: true })
        .map(line => line.flatMap(token => token.explanation!.map(e => ({
            text: e.content,
            scope: e.scopes.map(s => s.scopeName).filter(s => s != "source.squiffy").join(" "),
        }))));
}

function scopeOf(code: string, line: number, text: string) {
    const span = scopes(code)[line].find(s => s.text == text);
    if (!span) throw new Error(`"${text}" isn't a token on line ${line}: ${JSON.stringify(scopes(code)[line])}`);
    return span.scope;
}

describe("TextMate grammar", () => {
    test("every construct in the sample", () => {
        // Only this grammar's scopes, so that a Shiki update changing how JavaScript is
        // highlighted doesn't change the snapshot. Neighbouring text with the same scopes is merged.
        const result = scopes(sample).map(line => {
            const spans: { text: string, scope: string }[] = [];
            for (const span of line) {
                const scope = span.scope.split(" ").filter(s => !s.endsWith(".js")).join(" ");
                const last = spans.at(-1);
                if (last && last.scope == scope) last.text += span.text;
                else spans.push({ text: span.text, scope });
            }
            return spans.map(s => `${JSON.stringify(s.text)} ${s.scope}`).join("\n");
        });
        expect(result.join("\n\n")).toMatchSnapshot();
    });

    test("headers", () => {
        expect(scopeOf("[[a room]]:", 0, "a room")).toContain("entity.name.section.squiffy");
        expect(scopeOf("[look]:", 0, "look")).toContain("entity.name.function.passage.squiffy");
        expect(scopeOf("[snippet: hello]:", 0, "hello")).toContain("entity.name.type.snippet.squiffy");
    });

    test("indented lines are JavaScript only before a block's first line of text", () => {
        const code = "[[a]]:\n@set x = 1\n\n    js();\nText\n    not js();\n[b]:\n    js();";
        expect(scopeOf(code, 3, "js")).toContain("meta.embedded.block.javascript");
        expect(scopeOf(code, 5, "    not js();")).toBe("");
        expect(scopeOf(code, 7, "js")).toContain("meta.embedded.block.javascript");
    });

    test("indented lines at the top of a file are JavaScript", () => {
        expect(scopeOf("    js();\nText", 0, "js")).toContain("meta.embedded.block.javascript");
    });

    test("a snippet's content is text up to the next section", () => {
        const code = "[snippet: s]:\n[not a passage]:\n    not js\n[[a]]:\n    js();";
        expect(scopeOf(code, 1, "not a passage")).not.toContain("entity.name.function.passage");
        expect(scopeOf(code, 2, "    not js")).toContain("meta.snippet.body");
        expect(scopeOf(code, 4, "js")).toContain("meta.embedded.block.javascript");
    });

    test("links", () => {
        expect(scopeOf("Go [[north]].", 0, "north")).toContain("meta.link.section.squiffy");
        expect(scopeOf("Go [[north>]].", 0, ">")).toContain("keyword.operator.next-section.squiffy");
        expect(scopeOf("Go [[north]](room).", 0, "room")).toContain("markup.underline.link.squiffy");
        expect(scopeOf("[look](door, score+=1)", 0, "score")).toContain("variable.parameter.attribute.squiffy");
        expect(scopeOf("[look](door, score+=1)", 0, "+=")).toContain("keyword.operator.assignment.squiffy");
        expect(scopeOf("[look](door, not seen)", 0, "not")).toContain("keyword.operator.logical.squiffy");
        expect(scopeOf("[site](https://example.com)", 0, "https://example.com")).toContain("meta.link.url.squiffy");
    });

    test("@set takes one setter, whose value runs to the end of the line", () => {
        const code = "@set greeting := Hello, {{name}}!";
        expect(scopeOf(code, 0, " Hello, ")).toContain("string.unquoted.squiffy");
        expect(scopeOf(code, 0, "name")).toContain("variable.parameter.attribute.handlebars.squiffy");
    });

    test("handlebars", () => {
        expect(scopeOf("{{score}}", 0, "score")).toContain("variable.parameter.attribute.handlebars.squiffy");
        expect(scopeOf("{{get \"score\"}}", 0, "get")).toContain("support.function.helper.handlebars.squiffy");
        expect(scopeOf("{{#if a > 1}}x{{/if}}", 0, "#if")).toContain("keyword.control.block.handlebars.squiffy");
        expect(scopeOf("{{#if a > 1}}x{{/if}}", 0, ">")).toContain("keyword.operator.comparison.handlebars.squiffy");
        expect(scopeOf("{{random (array \"a\")}}", 0, "array")).toContain("support.function.helper.handlebars.squiffy");
        expect(scopeOf("{{! note }}", 0, " note ")).toContain("comment.block.handlebars.squiffy");
    });

    test("arithmetic", () => {
        const arithmetic = "keyword.operator.arithmetic.handlebars.squiffy";
        expect(scopeOf("{{set \"x\" a + b}}", 0, "+")).toContain(arithmetic);
        expect(scopeOf("{{#if a * 2 > 1}}x{{/if}}", 0, "*")).toContain(arithmetic);
        expect(scopeOf("{{set \"x\" a % b}}", 0, "%")).toContain(arithmetic);
        expect(scopeOf("{{set \"x\" a - b}}", 0, "-")).toContain(arithmetic);
        expect(scopeOf("{{set \"x\" a / b}}", 0, "/")).toContain(arithmetic);
        expect(scopeOf("{{set \"x\" -b}}", 0, "-")).toContain(arithmetic);
        expect(scopeOf("{{set \"x\" my-score}}", 0, "my-score")).toContain("variable.parameter.attribute.handlebars.squiffy");
        expect(scopeOf("{{set \"x\" ../score}}", 0, "/")).not.toContain(arithmetic);
        expect(scopeOf("{{set \"x\" a -1}}", 0, "-1")).toContain("constant.numeric.handlebars.squiffy");
        expect(scopeOf("{{= a * 2}}", 0, "=")).toContain("keyword.operator.display.handlebars.squiffy");
    });
});

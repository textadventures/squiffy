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

    test("@music and @sound (#444)", () => {
        expect(scopeOf("@music theme.mp3", 0, "music")).toContain("keyword.control.directive.squiffy");
        expect(scopeOf("@music theme.mp3", 0, "theme.mp3")).toContain("string.unquoted.squiffy");
        expect(scopeOf("@sound door.mp3", 0, "sound")).toContain("keyword.control.directive.squiffy");
    });

    test("@class (#449)", () => {
        expect(scopeOf("@class night forest", 0, "class")).toContain("keyword.control.directive.squiffy");
        expect(scopeOf("@class night forest", 0, "night forest")).toContain("string.unquoted.squiffy");
    });

    test("@transition (#489)", () => {
        expect(scopeOf("@transition fade 1s", 0, "transition")).toContain("keyword.control.directive.squiffy");
        expect(scopeOf("@transition fade 1s", 0, "fade 1s")).toContain("string.unquoted.squiffy");
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

    test("setter values are expressions, as in {{#if}}, in a story with a squiffy.json (#373)", () => {
        const attribute = "variable.parameter.attribute";
        expect(scopeOf("@set weapon = \"sword\"", 0, "sword")).toContain("string.quoted.double.handlebars.squiffy");
        expect(scopeOf("@set best = score", 0, "score")).toContain(attribute);
        expect(scopeOf("@set gold = gold + price * 2", 0, "+")).toContain("keyword.operator.arithmetic.handlebars.squiffy");
        expect(scopeOf("@set gold = gold + price * 2", 0, "price")).toContain(attribute);
        expect(scopeOf("@set gold = gold + price * 2", 0, "2")).toContain("constant.numeric.handlebars.squiffy");
        expect(scopeOf("@set rich = gold > 100", 0, ">")).toContain("keyword.operator.comparison.handlebars.squiffy");
        expect(scopeOf("@set lost = not has_key", 0, "not")).toContain("keyword.operator.logical.handlebars.squiffy");
        expect(scopeOf("@set seen_it = (seen \"intro\")", 0, "seen")).toContain("support.function.helper.handlebars.squiffy");
        expect(scopeOf("@set gold -= price", 0, "price")).toContain(attribute);
        expect(scopeOf("@set gold = 10", 0, "10")).toContain("constant.numeric.squiffy");
        expect(scopeOf("@set flag = true", 0, "true")).toContain("constant.language.boolean.squiffy");
        expect(scopeOf("@set status = hp ? \"ok\" : \"dead\"", 0, "?")).toContain("keyword.operator.ternary.handlebars.squiffy");
        expect(scopeOf("@set status = hp ? \"ok\" : \"dead\"", 0, ":")).toContain("keyword.operator.ternary.handlebars.squiffy");
        expect(scopeOf("{{#if bag contains \"key\"}}", 0, "contains")).toContain("keyword.operator.comparison.handlebars.squiffy");
        expect(scopeOf("{{#if (contains \"bag\" \"key\")}}", 0, "contains")).toContain("support.function.helper.handlebars.squiffy");
    });

    test("setter values without a squiffy.json: text and @attribute", () => {
        expect(scopeOf("@set greeting = Hello there", 0, "Hello there")).toContain("string.unquoted.squiffy");
        expect(scopeOf("@set best = @score", 0, "@score")).toContain("variable.parameter.attribute.squiffy");
    });

    test("commas inside quotes don't separate link setters", () => {
        const code = "[[Buy]](shop, msg = \"Hi, there\", gold -= price)";
        expect(scopeOf(code, 0, "Hi, there")).toContain("string.quoted.double.handlebars.squiffy");
        expect(scopeOf(code, 0, "-=")).toContain("keyword.operator.assignment.squiffy");
        expect(scopeOf(code, 0, "price")).toContain("variable.parameter.attribute");
    });

    test("a link's setters can have brackets in them", () => {
        const code = "[[Buy]](shop, gold *= (price - 1)) then [look](door, x = (a + (b * 2))) (aside)";
        expect(scopeOf(code, 0, "price")).toContain("meta.link.section.squiffy");
        expect(scopeOf(code, 0, "b")).toContain("meta.link.passage.squiffy");
        expect(scopeOf(code, 0, " (aside)")).not.toContain("meta.link");
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

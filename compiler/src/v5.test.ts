import { expect, test, describe } from "vitest";

import { compile } from "./compiler.js";
import { convertV5Syntax, findV5Syntax } from "./v5.js";

const convert = (script: string) => convertV5Syntax(script).script;

describe("findV5Syntax", () => {
    test.each([
        ["{if x:yes}", "{{#if x}}yes{{/if}}"],
        ["{else:no}", undefined],
        ["{x}", "{{x}}"],
        ["{@b+=1}", "{{inc \"b\"}}"],
        ["{rotate:a:b}", "{{rotate (array \"a\" \"b\")}}"],
        ["{sequence:a:b}", "{{sequence (array \"a\" \"b\")}}"],
        ["{label:1=text}", "{{#label \"1\"}}text{{/label}}"],
        ["{seen intro}", undefined],
    ])("detects %s", (text, suggestion) => {
        expect(findV5Syntax(`Some ${text} text`)).toEqual([{ line: 1, text, suggestion }]);
    });

    test("reports line numbers", () => {
        const script = `[[a]]:
Hello.

{if x:yes}{else:no}

[b]:
Value is {x}.`;
        expect(findV5Syntax(script).map(m => [m.line, m.text])).toEqual([
            [4, "{if x:yes}"],
            [4, "{else:no}"],
            [7, "{x}"],
        ]);
    });

    test("only reports the outermost command", () => {
        expect(findV5Syntax("{if x:{y}}").map(m => m.text)).toEqual(["{if x:{y}}"]);
    });

    test.each([
        ["Handlebars", "{{x}} {{#if x}}yes{{else}}no{{/if}} {{{html}}}"],
        ["Handlebars containing single braces", "{{set \"x\" \"{y}\"}}"],
        ["plain braces in prose", "A { and a } and {two words} and {a, b}"],
        ["empty braces", "{}"],
        ["unclosed braces", "{if x:yes"],
        ["an {if} with no colon", "{if x}"],
        ["reserved words", "{else} {true} {this}"],
        ["inline CSS", "<style>.x{color:red}</style><div style=\"a\">{</div>"],
        ["JSON", "{\"a\": 1}"],
        ["code spans", "Write `{x}` or ``{if x:y}``"],
    ])("doesn't detect %s", (_, script) => {
        expect(findV5Syntax(script)).toEqual([]);
    });

    test("ignores JavaScript, @ui blocks and snippets", () => {
        const script = `[[a]]:
    if (x) { y(); }
    var o = {x};
Text.

@ui
    var u = {x};
---
[snippet: s]:
{x}

[[b]]:
    function f() {return {x};}
Text`;
        expect(findV5Syntax(script)).toEqual([]);
    });

    test("detects commands in text that's indented after the text has started", () => {
        const script = `[[a]]:
Text

    {x}`;
        expect(findV5Syntax(script)).toEqual([{ line: 4, text: "{x}", suggestion: "{{x}}" }]);
    });
});

describe("convertV5Syntax", () => {
    test.each([
        // attributes
        ["{x}", "{{x}}"],
        ["You chose {gender}.", "You chose {{gender}}."],
        // if/else
        ["{if x:yes}", "{{#if x}}yes{{/if}}"],
        ["{if x:yes}{else:no}", "{{#if x}}yes{{else}}no{{/if}}"],
        ["{if x:yes} {else:no}", "{{#if x}}yes {{else}}no{{/if}}"],
        ["{if gender=male:You are male.}\n{else:You are female.}", "{{#if gender = \"male\"}}You are male.\n{{else}}You are female.{{/if}}"],
        ["{if gender=male:You are male.}", "{{#if gender = \"male\"}}You are male.{{/if}}"],
        ["{if score>100:High score!}", "{{#if score > 100}}High score!{{/if}}"],
        ["{if score>=100:a}", "{{#if score >= 100}}a{{/if}}"],
        ["{if score<=100:a}", "{{#if score <= 100}}a{{/if}}"],
        ["{if score<100:a}", "{{#if score < 100}}a{{/if}}"],
        ["{if score<>100:a}", "{{#if score != 100}}a{{/if}}"],
        ["{if a=@b:same}", "{{#if a = b}}same{{/if}}"],
        ["{if name=Bob \"B\":a}", "{{#if name = \"Bob \\\"B\\\"\"}}a{{/if}}"],
        ["{if not x:a}", "{{#if not x}}a{{/if}}"],
        ["{if seen intro:a}", "{{#if (seen \"intro\")}}a{{/if}}"],
        ["{if not seen the intro:a}", "{{#if not (seen \"the intro\")}}a{{/if}}"],
        ["{if x:a: b}", "{{#if x}}a: b{{/if}}"],
        ["{if x:{if y:both}}", "{{#if x}}{{#if y}}both{{/if}}{{/if}}"],
        ["{if x:value is {x}}{else:none}", "{{#if x}}value is {{x}}{{else}}none{{/if}}"],
        // setters
        ["{@b+=1}", "{{inc \"b\"}}"],
        ["{@b+=5}", "{{inc \"b\" 5}}"],
        ["{@b-=1}", "{{dec \"b\"}}"],
        ["{@b-=@c}", "{{dec \"b\" c}}"],
        ["{@b=5}", "{{set \"b\" 5}}"],
        ["{@b=hello}", "{{set \"b\" \"hello\"}}"],
        ["{@b=@c}", "{{set \"b\" c}}"],
        ["{@b}", "{{set \"b\" true}}"],
        ["{@not b}", "{{unset \"b\"}}"],
        ["{@a=1,b+=2,not c}", "{{set \"a\" 1}}{{inc \"b\" 2}}{{unset \"c\"}}"],
        // rotate and sequence
        ["{rotate:a:b:c}", "{{rotate (array \"a\" \"b\" \"c\")}}"],
        ["{rotate size:small:large}", "{{rotate (array \"small\" \"large\") set=\"size\"}}"],
        ["{sequence:first:second}", "{{sequence (array \"first\" \"second\")}}"],
        // labels
        ["{label:1=text}", "{{#label \"1\"}}text{{/label}}"],
        ["{label:a={x}}", "{{#label \"a\"}}{{x}}{{/label}}"],
        // mixed with Handlebars
        ["{{y}} {x} {{#if z}}{w}{{/if}}", "{{y}} {{x}} {{#if z}}{{w}}{{/if}}"],
    ])("converts %s", (v5, v6) => {
        const result = convertV5Syntax(v5);
        expect(result.script).toBe(v6);
        expect(result.problems).toEqual([]);
    });

    test("converts embeds of passages and sections", () => {
        const script = `[[a]]:
{p} {b} {other}

[p]:
Passage

[[b]]:
{p}`;
        expect(convert(script)).toBe(`[[a]]:
{{embed "p"}} {{embed "b"}} {{other}}

[p]:
Passage

[[b]]:
{{p}}`);
    });

    test("converts embeds of names containing spaces", () => {
        const script = `[[a]]:
{the end}

[[the end]]:
Done`;
        expect(convert(script)).toBe(`[[a]]:
{{embed "the end"}}

[[the end]]:
Done`);
    });

    test("converts the v5 text processor example", () => {
        const script = `Choose a gender:

* [[Male]](start, gender=male)
* [[Female]](start, gender=female)

[[start]]:
You chose {gender}.

{if gender=male:You are a man.}
{else:You are a woman.}

[Next]

[Next]:
This is a test. {passage} {section}

[passage]:
Text from passage.

[[section]]:
Text from section.`;
        const result = convertV5Syntax(script);
        expect(result.script).toBe(`Choose a gender:

* [[Male]](start, gender=male)
* [[Female]](start, gender=female)

[[start]]:
You chose {{gender}}.

{{#if gender = "male"}}You are a man.
{{else}}You are a woman.{{/if}}

[Next]

[Next]:
This is a test. {{embed "passage"}} {{embed "section"}}

[passage]:
Text from passage.

[[section]]:
Text from section.`);
        expect(result.converted).toBe(5);
        expect(result.problems).toEqual([]);
    });

    test("leaves JavaScript and other non-text lines alone", () => {
        const script = `@set x
[[a]]:
    var o = {x};
@title {x}
{x}`;
        expect(convert(script)).toBe(`@set x
[[a]]:
    var o = {x};
@title {x}
{{x}}`);
    });

    test("preserves Windows line endings", () => {
        expect(convert("[[a]]:\r\n{x}\r\n{y}\r\n")).toBe("[[a]]:\r\n{{x}}\r\n{{y}}\r\n");
    });

    test("returns the script unchanged when there's nothing to convert", () => {
        const script = "[[a]]:\nHello {{x}}.";
        expect(convertV5Syntax(script)).toEqual({ script, converted: 0, problems: [] });
    });

    test.each([
        ["an {else} on its own", "{else:no}", /doesn't directly follow/],
        ["{seen} outside an {if}", "{seen intro}", /only works as an \{if\} condition/],
        ["an {if} with an unparseable condition", "{if x y:a}", /condition can't be converted/],
        ["a comparison against an expression", "{if a=@b c:a}", /condition can't be converted/],
        ["a label with no '='", "{label:abc}", /no '='/],
        ["*=", "{@x*=2}", /no equivalent helper/],
        ["/=", "{@x/=2}", /no equivalent helper/],
        ["a non-numeric increment", "{@x+=a}", /isn't a number/],
        [":=", "{@x:={y}}", /can't be converted automatically/],
        ["@replace", "{@replace 1=text}", /@replace/],
        ["rotate options containing commands", "{rotate:{x}:b}", /contain text processor commands/],
        ["rotate with no options", "{rotate attr}", /no ':'/],
    ])("leaves %s as-is and reports it", (_, script, reason) => {
        const result = convertV5Syntax(`[[a]]:\nStart\n${script}`);
        expect(result.script).toBe(`[[a]]:\nStart\n${script}`);
        expect(result.problems.length).toBeGreaterThan(0);
        expect(result.problems[0].line).toBe(3);
        expect(result.problems[0].reason).toMatch(reason);
    });

    test.each([
        ["{if x:yes} and {else:no}", "{{#if x}}yes{{/if}} and {else:no}"],
        ["{if x:a}{else:b}{else:c}", "{{#if x}}a{{else}}b{{/if}}{else:c}"],
    ])("converts %s but leaves the unpaired {else} as-is", (v5, v6) => {
        const result = convertV5Syntax(v5);
        expect(result.script).toBe(v6);
        expect(result.problems).toEqual([
            { line: 1, text: v5.substring(v5.lastIndexOf("{else")), reason: expect.stringMatching(/doesn't directly follow/) },
        ]);
    });

    test("leaves an ambiguous {else} after a nested {if} as-is", () => {
        const script = "{if a:{if b:x}}{else:y}";
        const result = convertV5Syntax(script);
        expect(result.script).toBe(script);
        expect(result.problems).toEqual([
            { line: 1, text: "{if a:{if b:x}}", reason: expect.stringMatching(/not clear which \{if\}/) },
            { line: 1, text: "{else:y}", reason: expect.stringMatching(/doesn't directly follow/) },
        ]);
    });

    test("converts what it can around a problem", () => {
        const result = convertV5Syntax("{x}\n{@x*=2}\n{y}");
        expect(result.script).toBe("{{x}}\n{@x*=2}\n{{y}}");
        expect(result.converted).toBe(2);
        expect(result.problems).toEqual([{ line: 2, text: "{@x*=2}", reason: expect.any(String) }]);
    });

    test("reports problems nested inside converted commands with the right line", () => {
        const result = convertV5Syntax("[[a]]:\n{if x:line one\n{@y*=2}}");
        expect(result.script).toBe("[[a]]:\n{{#if x}}line one\n{@y*=2}{{/if}}");
        expect(result.problems).toEqual([{ line: 3, text: "{@y*=2}", reason: expect.any(String) }]);
    });

    test("converted output compiles without v5 warnings", async () => {
        const script = convert(`[[a]]:
{if x:yes}{else:no} {x} {@b+=1} {rotate:a:b} {label:l=text} [[b]]

[[b]]:
{a}`);
        const warnings: string[] = [];
        const result = await compile({ script, onWarning: w => warnings.push(w) });
        expect(result.success).toBe(true);
        expect(warnings).toEqual([]);
    });
});

describe("compiler warnings", () => {
    test("warns about v5 syntax with the filename and line", async () => {
        const warnings: string[] = [];
        await compile({
            scriptBaseFilename: "story.squiffy",
            script: "[[a]]:\n@set x\n{if x:yes}{else:no} {x}",
            onWarning: w => warnings.push(w),
        });
        expect(warnings).toEqual([
            "WARNING: story.squiffy line 3: {if x:yes} looks like Squiffy 5 text processor syntax, which isn't supported in Squiffy 6. Use {{#if x}}yes{{/if}} instead.",
            "WARNING: story.squiffy line 3: {else:no} looks like Squiffy 5 text processor syntax, which isn't supported in Squiffy 6. Use {{else}} inside an {{#if}} block instead.",
            "WARNING: story.squiffy line 3: {x} looks like Squiffy 5 text processor syntax, which isn't supported in Squiffy 6. Use {{x}} instead.",
        ]);
    });

    test("doesn't warn about Handlebars syntax", async () => {
        const warnings: string[] = [];
        await compile({
            scriptBaseFilename: "story.squiffy",
            script: "[[a]]:\n    var o = {a: 1};\n{{#if x}}yes{{else}}no{{/if}} {{x}}",
            onWarning: w => warnings.push(w),
        });
        expect(warnings).toEqual([]);
    });
});

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
        ["comments with }} in them", "{{!-- msg (\"{{a}} {if x:y}\") --}}"],
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
        ["an {else} on its own", "{else:no}", /no \{if \.\.\.:\.\.\.\} before/],
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

    // In v5, {else:...} shows its text if the last {if} that ran was false (#660)
    test.each([
        ["{if x:yes} and {else:no}", "{{#if x}}yes{{/if}} and {{#unless x}}no{{/unless}}"],
        ["{if gender=boy:You are a wizard.}\nHello.\n{else:You are a witch.}",
            "{{#if gender = \"boy\"}}You are a wizard.{{/if}}\nHello.\n{{#unless gender = \"boy\"}}You are a witch.{{/unless}}"],
        ["{if x:a}{else:b}{else:c}", "{{#if x}}a{{else}}b{{/if}}{{#unless x}}c{{/unless}}"],
        ["{if not seen intro:a} {x} {else:b}", "{{#if not (seen \"intro\")}}a{{/if}} {{x}} {{#unless not (seen \"intro\")}}b{{/unless}}"],
        ["{if x:a} {label:1=text} {else:b}", "{{#if x}}a{{/if}} {{#label \"1\"}}text{{/label}} {{#unless x}}b{{/unless}}"],
        // A nested {if} has run before the outer one remembers whether it was true
        ["{if a:{if b:x}}{else:y}", "{{#if a}}{{#if b}}x{{/if}}{{else}}y{{/if}}"],
        ["{if a:{if b:x}} {else:y}", "{{#if a}}{{#if b}}x{{/if}} {{else}}y{{/if}}"],
        ["{if a:{if b:x}} and {else:y}", "{{#if a}}{{#if b}}x{{/if}}{{/if}} and {{#unless a}}y{{/unless}}"],
        // The {else} belongs to the last {if}
        ["{if a:x} {if b:y} {else:z}", "{{#if a}}x{{/if}} {{#if b}}y {{else}}z{{/if}}"],
        ["{if a:x}, {if b:y}, {else:z}", "{{#if a}}x{{/if}}, {{#if b}}y{{/if}}, {{#unless b}}z{{/unless}}"],
        // Something setting an attribute before the {if} doesn't matter
        ["{@x}{if x:a} {else:b}", "{{set \"x\" true}}{{#if x}}a {{else}}b{{/if}}"],
    ])("converts the {else} in %s", (v5, v6) => {
        const result = convertV5Syntax(v5);
        expect(result.problems).toEqual([]);
        expect(result.script).toBe(v6);
    });

    test.each([
        ["setting an attribute in the {if}", "{if x:{@not x}}, {else:b}", /could change/],
        ["setting an attribute between them", "{if x:a}, {@not x}{else:b}", /could change/],
        ["a rotate that sets an attribute", "{if x:a}, {rotate x:a:b}{else:b}", /could change/],
        ["Handlebars between them", "{if x:a}, {{set \"x\" false}} {else:b}", /could change/],
        ["an embedded passage", "{if x:a}, {p} {else:b}", /could run an \{if\} of its own/],
        ["an {if} in a label", "{if x:a}, {label:1={if y:b}} {else:b}", /could run an \{if\} of its own/],
        ["an {if} in the {else} before", "{if x:a}{else:{if y:b}}, {else:c}", /could run an \{if\} of its own/],
        ["an {if} that can't be converted", "{if x y:a}, {else:b}", /can't be converted/],
    ])("leaves an {else} after %s as-is", (_, v5, reason) => {
        const result = convertV5Syntax(`[[a]]:\n${v5}\n\n[p]:\nP`);
        const elseText = v5.substring(v5.lastIndexOf("{else:"));
        expect(result.script).toContain(elseText);
        expect(result.problems.at(-1)).toEqual({ line: 2, text: elseText, reason: expect.stringMatching(reason) });
    });

    test("reads the text either side of a line like @set as one, as v5 did", () => {
        const result = convertV5Syntax("[[a]]:\n{if x:a\n@set y = {z}\nb}\n@inc n\n{else:c}");
        expect(result.problems).toEqual([]);
        expect(result.script).toBe("[[a]]:\n{{#if x}}a\n@set y = {z}\nb{{/if}}\n@inc n\n{{#unless x}}c{{/unless}}");
    });

    test("doesn't pair an {else} with an {if} in another passage", () => {
        const result = convertV5Syntax("[[a]]:\n{if x:a}\n\n[p]:\n{else:b}");
        expect(result.script).toBe("[[a]]:\n{{#if x}}a{{/if}}\n\n[p]:\n{else:b}");
        expect(result.problems).toEqual([{ line: 5, text: "{else:b}", reason: expect.stringMatching(/no \{if/) }]);
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
        // Nothing sets x or a, but that's not what this is about
        expect(warnings.filter(w => !w.includes("isn't a helper"))).toEqual([]);
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
            script: "[[a]]:\n@set x\n    var o = {a: 1};\n{{#if x}}yes{{else}}no{{/if}} {{x}}",
            onWarning: w => warnings.push(w),
        });
        expect(warnings).toEqual([]);
    });
});

describe("@replace", () => {
    test("converts a link that replaces a label to a link to a new passage that does it", () => {
        const script = `[[a]]:
I bought {label:2=a pint of milk}. But I [don't really like milk](@replace 2=beer).

[[b]]:
Done.`;
        const result = convertV5Syntax(script);
        expect(result.problems).toEqual([]);
        expect(result.script).toBe(`[[a]]:
I bought {{#label "2"}}a pint of milk{{/label}}. But I [don't really like milk](@replace 2=beer).

[don't really like milk]:
{{#replace "2"}}beer{{/replace}}

[[b]]:
Done.`.replace("(@replace 2=beer)", ""));
        expect(result.converted).toBe(2);
    });

    test("embeds a passage or section that the replacement names, as v5 did", () => {
        const result = convertV5Syntax("[[a]]:\n[x](@replace 1=beer, @replace 2=b, @replace 3=other)\n\n[beer]:\nBeer\n\n[[b]]:\nB");
        expect(result.script).toBe("[[a]]:\n[x]\n\n[beer]:\nBeer\n\n[x]:\n{{#replace \"1\"}}{{embed \"beer\"}}{{/replace}}{{#replace \"2\"}}{{embed \"b\"}}{{/replace}}{{#replace \"3\"}}other{{/replace}}\n\n[[b]]:\nB");
    });

    test("names the new passage after the link, unless that's taken or isn't a good name", () => {
        const script = "[[a]]:\n[x](@replace 1=e) [x](@replace 1=b) [**y**](@replace 2=c) [z](@replace 1=d, seen_z)\n\n[x 2]:\nTaken";
        const result = convertV5Syntax(script);
        expect(result.problems).toEqual([]);
        expect(result.script).toBe("[[a]]:\n[x] [x](x 3) [**y**](replace 2) [z](z, seen_z)\n\n[x 2]:\nTaken\n\n"
            + "[x]:\n{{#replace \"1\"}}e{{/replace}}\n\n[x 3]:\n{{#replace \"1\"}}b{{/replace}}\n\n"
            + "[replace 2]:\n{{#replace \"2\"}}c{{/replace}}\n\n[z]:\n{{#replace \"1\"}}d{{/replace}}");
    });

    test("converts links inside other commands, and v5 commands in the replacement", () => {
        const result = convertV5Syntax("[[a]]:\nI {label:3=[hate walking](@replace 1=teleported {x}, @replace 3=love it)}.\n");
        expect(result.problems).toEqual([]);
        expect(result.script).toBe("[[a]]:\nI {{#label \"3\"}}[hate walking]{{/label}}.\n\n"
            + "[hate walking]:\n{{#replace \"1\"}}teleported {{x}}{{/replace}}{{#replace \"3\"}}love it{{/replace}}\n");
    });

    test("adds the passage before the next section, or the continue line", () => {
        const result = convertV5Syntax("[[a]]:\n[x](@replace 1=y)\n+++Continue\nMore");
        expect(result.script).toBe("[[a]]:\n[x]\n\n[x]:\n{{#replace \"1\"}}y{{/replace}}\n\n+++Continue\nMore");
    });

    test("compiles, with the passage in the right section", async () => {
        const script = convert("[[a]]:\n{label:1=milk} [x](@replace 1=beer)\n\n[[b]]:\nB");
        const result = await compile({ script });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(Object.keys(result.output.story.sections["a"].passages ?? {})).toEqual(["x"]);
        }
    });

    test.each([
        ["a link that goes somewhere", "[x](p, @replace 1=y)", /put \{\{#replace "1"\}\}\.\.\.\{\{\/replace\}\} in the passage it goes to/],
        ["a section link", "[[x]](b, @replace 1=y)", /in the section it goes to/],
        ["a section link that goes nowhere", "[[x]](@replace 1=y)", /doesn't name a section/],
        ["no label", "[x](@replace y)", /isn't a label name/],
    ])("reports %s", (_, link, reason) => {
        const script = `[[a]]:\nStart ${link}\n\n[p]:\nP\n\n[[b]]:\nB`;
        const result = convertV5Syntax(script);
        expect(result.script).toBe(script);
        expect(result.problems).toEqual([{ line: 2, text: link, reason: expect.stringMatching(reason) }]);
    });

    test("leaves links without @replace alone", () => {
        const script = "[[a]]:\n[x](p, y=1) [[b]](b, @y) [web](https://example.com/@replace)";
        expect(convertV5Syntax(script)).toEqual({ script, converted: 0, problems: [] });
    });

    test("converts @replace lines", () => {
        const result = convertV5Syntax("[[a]]:\n@replace 4=ended [abruptly] for {name}.\nOh well.\n\n[b]:\n@replace w=");
        expect(result.problems).toEqual([]);
        expect(result.script).toBe("[[a]]:\n{{#replace \"4\"}}ended [abruptly] for {{name}}.{{/replace}}\nOh well.\n\n[b]:\n{{#replace \"w\"}}{{/replace}}");
    });

    test("reports an @replace line with JavaScript after it, which would become text", () => {
        const script = "[[a]]:\n@replace 1=x\n    var a = $(\"#a\");\nText @replace 1=y";
        const result = convertV5Syntax(script);
        expect(result.problems[0]).toEqual({ line: 2, text: "@replace 1=x", reason: expect.stringMatching(/JavaScript after it/) });
        expect(result.script).toBe(script);
    });

    test("finds links and lines with @replace", () => {
        expect(findV5Syntax("[[a]]:\n[x](@replace 1=y)\n@replace 2=z")).toEqual([
            { line: 2, text: "[x](@replace 1=y)" },
            { line: 3, text: "@replace 2=z", suggestion: "{{#replace \"2\"}}z{{/replace}}" },
        ]);
    });
});

describe("JavaScript", () => {
    test.each([
        ["squiffy.set(\"name\", jQuery(\"#name\").val());", "squiffy.set(\"name\", document.getElementById(\"name\")?.value);"],
        ["squiffy.set('n', $('#my-name').val().toLowerCase());", "squiffy.set('n', document.getElementById(\"my-name\")?.value.toLowerCase());"],
        ["squiffy.set(\"n\", jQuery(\"#n\").prop(\"disabled\", true).removeAttr(\"id\").val());",
            "squiffy.set(\"n\", (element => { if (!element) return undefined; element.disabled = true; element.removeAttribute(\"id\"); return element.value; })(document.getElementById(\"n\")));"],
    ])("converts %s", (js, converted) => {
        const result = convertV5Syntax(`[[a]]:\n    ${js}\nText`);
        expect(result.problems).toEqual([]);
        expect(result.script).toBe(`[[a]]:\n    ${converted}\nText`);
        expect(result.converted).toBe(1);
    });

    test.each([
        "$(\"#x\").css(\"color\", \"red\");",
        "jQuery(\"#x\").val(\"y\");",
        "var w = $.now();",
        "squiffy.set(\"a\", jQuery(this).val());",
    ])("reports other jQuery: %s", js => {
        const script = `[[a]]:\n    ${js}\nText`;
        const result = convertV5Syntax(script);
        expect(result.script).toBe(script);
        expect(result.problems).toEqual([{ line: 2, text: js, reason: expect.stringMatching(/jQuery/), javascript: true }]);
    });

    test("doesn't report things that only look like jQuery", () => {
        const script = "[[a]]:\n    var s = `${x}`; my$(1); a.$(2);\nText";
        expect(convertV5Syntax(script)).toEqual({ script, converted: 0, problems: [] });
    });
});

describe("stray braces", () => {
    test.each([
        ["[[go]]}", "[[go]]&#125;"],
        ["[go](p)} and {[x]", "[go](p)&#125; and &#123;[x]"],
        ["{{x}}} after a command", "{{x}}&#125; after a command"],
    ])("escapes %s, which would make }}} once links and commands are Handlebars", (v5, converted) => {
        const result = convertV5Syntax(`[[a]]:\n${v5}\n\n[[go]]:\nGo`);
        expect(result.script).toBe(`[[a]]:\n${converted}\n\n[[go]]:\nGo`);
        expect(findV5Syntax(`[[a]]:\n${v5}`)).toEqual([]);
    });

    test("an escaped brace compiles where the brace didn't", async () => {
        expect((await compile({ script: "[[a]]:\n[[go]]}\n\n[[go]]:\nGo" })).success).toBe(false);
        expect((await compile({ script: convert("[[a]]:\n[[go]]}\n\n[[go]]:\nGo") })).success).toBe(true);
    });

    test("leaves braces that are matched, or not next to a link", () => {
        const script = "[[a]]:\n{a [b]} {two words} and } and {{x}}";
        expect(convertV5Syntax(script)).toEqual({ script, converted: 0, problems: [] });
    });
});

describe("links", () => {
    test("puts text in quotes in a link's text in single quotes, as the link's text is in double quotes once it's compiled", async () => {
        const script = convert("[[a]]:\n[[Talk to {if dad=yes:Dad}{else:Giles}]](b) [Say \"hi\"](p)\n\n[p]:\nP\n\n[[b]]:\nB");
        expect(script).toBe("[[a]]:\n[[Talk to {{#if dad = 'yes'}}Dad{{else}}Giles{{/if}}]](b) [Say \"hi\"](p)\n\n[p]:\nP\n\n[[b]]:\nB");
        expect((await compile({ script })).success).toBe(true);
    });
});

describe("accented attribute names", () => {
    test("converts them", () => {
        const result = convertV5Syntax("{if Zähler>1:a} {Josué} {@Zähler+=1} {if not mönjä:b}");
        expect(result.problems).toEqual([]);
        expect(result.script).toBe("{{#if Zähler > 1}}a{{/if}} {{Josué}} {{inc \"Zähler\"}} {{#if not mönjä}}b{{/if}}");
    });
});

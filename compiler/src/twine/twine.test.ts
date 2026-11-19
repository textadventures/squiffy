import { describe, expect, test } from "vitest";
import { analyse } from "../analyse.js";
import { convertTwine, formatTwineProblems, sanitiseName } from "./convert.js";
import { parseTwine, TwineParseError } from "./story.js";

// A Twee story in the given format, from passages written as ":: Name" and their text
function twee(format: "Harlowe" | "SugarCube", passages: string): string {
    return `:: StoryTitle\nTest story\n\n:: StoryData\n{ "format": "${format}", "format-version": "1.0.0", "start": "Start" }\n\n${passages}`;
}

// Converts a story, checks the result compiles, and returns its .squiffy file
async function convert(format: "Harlowe" | "SugarCube", passages: string) {
    const result = convertTwine(twee(format, passages));
    const script = result.files[result.main];
    const analysis = await analyse({ script, expressions: true });
    expect(analysis.diagnostics.filter(d => d.severity == "error")).toEqual([]);
    return { script, result };
}

// The text of one section of a converted story, up to the next section
function section(script: string, name: string): string {
    const start = script.indexOf(`[[${name}]]:\n`);
    expect(start, `section ${name}`).not.toBe(-1);
    const rest = script.substring(start + name.length + 6);
    const end = rest.search(/^\[\[.*\]\]:$/m);
    return (end == -1 ? rest : rest.substring(0, end)).trim();
}

describe("reading Twine stories", () => {
    test("Twee 3", () => {
        const story = parseTwine(`:: StoryTitle
The Cave

:: StoryData
{ "ifid": "1234", "format": "SugarCube", "format-version": "2.37.3", "start": "Begin" }

:: Begin [start-tag other] {"position":"100,100","size":"200,100"}
Hello.

:: A \\[bracketed\\] name
\\:: Not a passage

:: Story Stylesheet [stylesheet]
body { color: red; }

:: Story JavaScript [script]
setup.x = 1;
`);
        expect(story.title).toBe("The Cave");
        expect(story.format).toBe("sugarcube");
        expect(story.formatVersion).toBe("2.37.3");
        expect(story.start).toBe("Begin");
        expect(story.passages).toEqual([
            { name: "Begin", tags: ["start-tag", "other"], text: "Hello.", position: [100, 100], size: [200, 100] },
            { name: "A [bracketed] name", tags: [], text: ":: Not a passage" },
        ]);
        expect(story.stylesheet).toBe("body { color: red; }");
        expect(story.script).toBe("setup.x = 1;");
    });

    test("Twine 2 HTML", () => {
        const story = parseTwine(`<html><body><tw-storydata name="Café &amp; Bar" startnode="2" format="Harlowe" format-version="3.3.9">
<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css">tw-story { color: red; }</style>
<script role="script" id="twine-user-script" type="text/twine-javascript">window.x = 1 &lt; 2;</script>
<tw-passagedata pid="1" name="Other" tags="" position="300.5,25" size="100,100">Some &quot;text&quot;</tw-passagedata>
<tw-passagedata pid="2" name="First" tags="header" position="0,0">(set: $x to 1)
[[Other]]</tw-passagedata>
</tw-storydata></body></html>`);
        expect(story.title).toBe("Café & Bar");
        expect(story.format).toBe("harlowe");
        expect(story.start).toBe("First");
        expect(story.passages).toEqual([
            { name: "Other", tags: [], text: "Some \"text\"", position: [300.5, 25], size: [100, 100] },
            { name: "First", tags: ["header"], text: "(set: $x to 1)\n[[Other]]", position: [0, 0] },
        ]);
        expect(story.stylesheet).toBe("tw-story { color: red; }");
        expect(story.script).toBe("window.x = 1 < 2;");
    });

    test("Twine 1 HTML", () => {
        const story = parseTwine(`<html><body><div id="storeArea" data-size="3">
<div tiddler="StoryTitle" tags="">Old story</div>
<div tiddler="Start" tags="">Line one\\nLine two [[Next]]</div>
<div tiddler="Next" tags="" twine-position="410,10">The end.</div>
</div></body></html>`);
        expect(story.title).toBe("Old story");
        expect(story.format).toBe("sugarcube");
        expect(story.start).toBe("Start");
        expect(story.passages.map(p => p.text)).toEqual(["Line one\nLine two [[Next]]", "The end."]);
        expect(story.passages.map(p => p.position)).toEqual([undefined, [410, 10]]);
    });

    test("something that isn't a Twine story", () => {
        expect(() => parseTwine("<html><body>Hello</body></html>")).toThrow(TwineParseError);
    });
});

describe("the converted story", () => {
    test("has a title, a start, one screen per passage and a squiffy.json", async () => {
        const { script, result } = await convert("Harlowe", ":: Intro\nNot the start.\n\n:: Start\nThe start.");
        expect(script.startsWith("@title Test story\n@start Start\n\n[[]]:\n@clear\n\n[[Intro]]:\nNot the start.")).toBe(true);
        expect(JSON.parse(result.files["squiffy.json"])).toMatchObject({ main: "story.squiffy" });
        expect(result.passages).toBe(2);
    });

    test("keeps where the passages are on Twine's map", () => {
        const result = convertTwine(twee("Harlowe", `:: Start {"position":"100,200"}
[[Room, 1]]

:: Room, 1 {"position":"350,325","size":"200,100"}
One

:: Elsewhere
Not on the map`));
        // Box centres, from the top left one, stretched sideways
        expect(JSON.parse(result.files["squiffy.json"]).map).toEqual({ sections: { "Start": [0, 0], "Room 1": [480, 125] } });
        expect(result.files["squiffy.json"]).toContain("\"Room 1\": [480, 125]");
    });

    test("leaves out a Twine map that was never arranged", () => {
        // Twine and Tweego put passages without positions in rows of ten
        const passages = Array.from({ length: 25 }, (_, i) =>
            `:: P${i} {"position":"${100 + (i % 10) * 125},${100 + Math.floor(i / 10) * 125}"}\nText`);
        passages[3] = ":: P3 {\"position\":\"2000,2000\"}\nMoved";
        const result = convertTwine(twee("Harlowe", passages.join("\n\n")));
        expect(JSON.parse(result.files["squiffy.json"]).map).toBeUndefined();
    });

    test("tidies passage names that would break Squiffy links", () => {
        expect(sanitiseName("Room [1], upstairs")).toBe("Room (1) upstairs");
        expect(sanitiseName("Go on >")).toBe("Go on");
        expect(sanitiseName("a (b")).toBe("a b");
        expect(sanitiseName("@1")).toBe("1");
    });

    test("names that clash once tidied get a number", async () => {
        const { script } = await convert("Harlowe", ":: Start\n[[Room, 1]] [[Room 1]] [[Room 1 2]]\n\n:: Room, 1\nOne\n\n:: Room 1\nTwo\n\n:: Room 1 2\nThree");
        expect(section(script, "Start")).toBe("[[Room, 1]](Room 1 3) [[Room 1]] [[Room 1 2]]");
        expect(section(script, "Room 1 3")).toBe("One");
    });

    test("line breaks in a passage stay line breaks", async () => {
        const { script } = await convert("Harlowe", ":: Start\nOne\nTwo\n\nA new paragraph.\n* a list\n* of things");
        expect(section(script, "Start")).toBe("One<br>\nTwo\n\nA new paragraph.\n* a list\n* of things");
    });

    test("text that Squiffy would read as something else", async () => {
        const { script } = await convert("SugarCube", ":: Start\n@set x = 1\n[not a link] and {{not a helper}}\n+++ not a continue link\n    not JavaScript");
        expect(section(script, "Start")).toBe(
            "&#64;set x = 1<br>\n&#91;not a link&#93; and &#123;{not a helper&#125;}<br>\n&#43;++ not a continue link<br>\nnot JavaScript");
    });

    test("the stylesheet and JavaScript are kept in files", () => {
        const result = convertTwine(":: StoryData\n{\"format\": \"Harlowe\"}\n\n:: Start\nHi\n\n:: Style [stylesheet]\nbody {}\n\n:: Script [script]\nwindow.x = 1;");
        expect(result.files["story.css"]).toBe("body {}\n");
        expect(result.files["story.js"]).toBe("window.x = 1;\n");
        // squiffy.json makes the stylesheet part of the story, but leaves out the JavaScript
        expect(result.files["story.squiffy"]).not.toContain("story.css");
        expect(result.files["story.squiffy"]).not.toContain("story.js");
        expect(JSON.parse(result.files["squiffy.json"]).exclude).toEqual(["story.js"]);
        expect(result.problems.map(p => p.text)).toEqual(["story.css", "story.js"]);
    });

    test("the problems, as a text file", () => {
        const result = convertTwine(twee("Harlowe", ":: Start\n(alert: \"Hi\")"));
        expect(formatTwineProblems(result, "test.twee")).toBe(`Converted test.twee (Harlowe 1.0.0) to Squiffy: 1 passage.

1 thing couldn't be converted exactly. Where something couldn't be converted at all, the story has the
Twine code in a comment, {{!-- Twine: ... --}}, so you can search for "Twine:" to find them.

Start:
  (alert: "Hi")
    This couldn't be converted: the (alert:) macro, which Squiffy has no equivalent for.
`);
    });
});

describe("Harlowe", () => {
    test("links", async () => {
        const { script } = await convert("Harlowe", ":: Start\n[[Cave]] [[Go in->Cave]] [[Cave<-Enter]] [[Old|Cave]] [[Away->Nowhere]] [[Site->https://example.com]]\n\n:: Cave\nDark.");
        expect(section(script, "Start")).toBe(
            "[[Cave]] [[Go in]](Cave) [[Enter]](Cave) [[Old]](Cave) [[Away]](Nowhere) <a href=\"https://example.com\" target=\"_blank\">Site</a>");
    });

    test("(set:) at the start of a passage becomes @set, and later on {{set}}", async () => {
        const { script } = await convert("Harlowe", ":: Start\n(set: $gold to 10)(set: $name to \"Ann\", $gold to it + 5)\nHello.\n(set: $gold to $gold - 2)(set: $won to true)(put: 3 into $x)");
        expect(section(script, "Start")).toBe(
            "@set gold = 10\n@set name = \"Ann\"\n@inc gold 5\nHello.\n{{dec \"gold\" 2}}{{set \"won\" true}}{{set \"x\" 3}}");
    });

    test("arrays", async () => {
        const { script } = await convert("Harlowe", ":: Start\nHi (set: $bag to (a: \"key\"))(set: $bag to it + (a: \"map\"))(set: $bag to it - (a: \"key\"))(if: $bag contains \"map\" and $bag's length > 0)[Yes]");
        expect(section(script, "Start")).toBe(
            "Hi {{set \"bag\" (array \"key\")}}{{append \"bag\" \"map\"}}{{remove \"bag\" \"key\"}}{{#if (contains \"bag\" \"map\") and (length \"bag\") > 0}}Yes{{/if}}");
    });

    test("datamaps become an attribute for each value", async () => {
        const { script } = await convert("Harlowe", ":: Start\n(set: $player to (dm: \"hp\", 10, \"name\", \"Ann\"))$player's name has (print: $player's hp) HP.");
        expect(section(script, "Start")).toBe("@set player_hp = 10\n@set player_name = \"Ann\"\n{{player_name}} has {{player_hp}} HP.");
    });

    test("(if:), (else-if:), (else:) and (unless:)", async () => {
        const { script } = await convert("Harlowe", ":: Start\n(if: $a is 1 or 2)[One or two](else-if: $b is not \"x\")[Not x]\n(else:)[Else] (unless: visits > 1)[First time]");
        expect(section(script, "Start")).toBe(
            "{{#if a = 1 or a = 2}}One or two{{else if b != \"x\"}}Not x{{else}}Else{{/if}} {{#if not (visits \"Start\") > 1}}First time{{/if}}");
    });

    test("printing, either and random", async () => {
        const { script } = await convert("Harlowe", ":: Start\n$name and _temp. (print: $gold * 2) (either: \"a\", \"b\") (random: 1, 3)");
        expect(section(script, "Start")).toBe(
            "{{name}} and {{temp}}. {{= gold * 2}} {{random (array \"a\" \"b\")}} {{random (array 1 2 3)}}");
    });

    test("(display:) and (go-to:)", async () => {
        const { script } = await convert("Harlowe", ":: Start\n(display: \"Bit\") (go-to: \"End\") (after: 2s)[(goto: \"End\")]\n\n:: Bit\nA bit.\n\n:: End\nThe end.");
        expect(section(script, "Start")).toBe("{{embed \"Bit\"}} {{goto \"End\"}} {{goto \"End\" after=2000}}");
    });

    test("a link that sets variables and goes to a passage is a link with setters", async () => {
        const { script } = await convert("Harlowe", ":: Start\n(link: \"Buy\")[(set: $gold to it - 5)(set: $sword to true)(goto: \"Shop\")] (link-goto: \"Leave\", \"Shop\")\n\n:: Shop\nShop.");
        expect(section(script, "Start")).toBe("[[Buy]](Shop, gold -= 5, sword = true) [[Leave]](Shop)");
    });

    test("a link that does more goes through a section of its own", async () => {
        const { script } = await convert("Harlowe", ":: Start\n(link: \"Buy\")[(set: $gold to 5)You buy it.(goto: \"Shop\")]\n\n:: Shop\nShop.");
        expect(section(script, "Start")).toBe("[[Buy]](Start: Buy)");
        expect(section(script, "Start: Buy")).toBe("@set gold = 5\nYou buy it.{{goto \"Shop\"}}");
    });

    test("(link:) and (link-reveal:) show their hooks", async () => {
        const { script } = await convert("Harlowe", ":: Start\n(link: \"Open\")[It's empty.] (link-reveal: \"Look\")[ around.]");
        expect(section(script, "Start")).toBe(`{{#label "open"}}[Open](Open){{/label}} {{#label "look"}}[Look](Look){{/label}}

[Open]:
{{#replace "open"}}It's empty.{{/replace}}

[Look]:
{{#replace "look"}}Look around.{{/replace}}`);
    });

    test("named hooks, (replace:), (show:) and (click:)", async () => {
        const { script } = await convert("Harlowe", ":: Start\n|door>[The door is shut.] |note)[A note!] [[Leave]]\n(link: \"Kick\")[(replace: ?door)[The door is open.](show: ?note)] (click: ?door)[(set: $tried to true)]\n\n:: Leave\nBye.");
        expect(section(script, "Start")).toBe(`{{#label "door"}}[The door is shut.](The door is shut.){{/label}} {{#label "note"}}{{/label}} [[Leave]]<br>
{{#label "kick"}}[Kick](Kick){{/label}}

[The door is shut.]:
{{#replace "door"}}The door is shut.{{/replace}}{{set "tried" true}}

[Kick]:
{{#replace "kick"}}{{#replace "door"}}The door is open.{{/replace}}{{#replace "note"}}A note!{{/replace}}{{/replace}}`);
    });

    test("(click: ?page) hooks become a chain of Continue links", async () => {
        const { script, result } = await convert("Harlowe", ":: Start\nFirst. (click: ?page)[Second.] (click: ?page)[Third.]");
        expect(section(script, "Start")).toBe(`First. {{#label "continue"}}[Continue](Continue){{/label}}

[Continue]:
{{#replace "continue"}}{{/replace}}Second.

{{#label "continue-2"}}[Continue](Continue 2){{/label}}

[Continue 2]:
{{#replace "continue-2"}}{{/replace}}Third.`);
        expect(result.problems[0].reason).toBe("Clicking anywhere on the page has been converted to Continue links.");
    });

    test("(click:) on text", async () => {
        const { script } = await convert("Harlowe", ":: Start\nThere's a lamp here. (click: \"lamp\")[It's lit.]");
        expect(section(script, "Start")).toBe(`There's a {{#label "click-text-1"}}[lamp](lamp){{/label}} here.

[lamp]:
{{#replace "click-text-1"}}lamp{{/replace}}It's lit.`);
    });

    test("input, cycling links and dropdowns", async () => {
        const { script } = await convert("Harlowe", ":: Start\n(input-box: bind $name, \"=X=\", 1, \"Ann\") (cycling-link: bind $size, \"small\", \"large\") (dropdown: bind $colour, \"red\", \"blue\")");
        expect(section(script, "Start")).toBe(
            "{{set \"name\" \"Ann\"}}<input type=\"text\" data-attribute=\"name\" value=\"Ann\"> "
            + "{{rotate (array \"small\" \"large\") set=\"size\"}} "
            + "<select data-attribute=\"colour\"><option value=\"red\">red</option><option value=\"blue\">blue</option></select>");
    });

    test("markup", async () => {
        const { script } = await convert("Harlowe", ":: Start\n''Bold'' //italic// **strong** *em* ~~struck~~ ^^up^^ http://example.com\n#Heading\n---\n=><=\nCentred\n{\nCollapsed\nlines\n}\n`(set: $x to 1)`");
        expect(section(script, "Start")).toBe(
            "**Bold** _italic_ **strong** _em_ <s>struck</s> <sup>up</sup> http://example.com\n# Heading\n<hr>\n"
            + "<div style=\"text-align: center\">\n\nCentred<br>\nCollapsed lines<br>\n(set: $x to 1)\n\n</div>");
    });

    test("styling changers", async () => {
        const { script, result } = await convert("Harlowe", ":: Start\n(text-colour: red)[Red] (colour: #f00)[Hex] (text-style: \"italic\", \"shudder\")[Wobbly] (link-style: (text-colour: red))[(link: \"x\")[y]]");
        expect(section(script, "Start")).toMatch(/^<span style="color: red">Red<\/span> <span style="color: #f00">Hex<\/span> _Wobbly_ \{\{#label "x"\}\}/);
        expect(result.problems.map(p => p.text)).toEqual(["\"shudder\"", "(link-style:)"]);
    });

    test("header and footer passages, and startup passages", async () => {
        const { script } = await convert("Harlowe", ":: Start\nThe start.\n\n:: Top [header]\nScore: $score\n\n:: Bottom [footer]\nThe end of the page.\n\n:: Init [startup]\n(set: $score to 0)");
        expect(section(script, "")).toBe("@clear\n{{score}}".replace("{{score}}", "Score: {{score}}"));
        expect(section(script, "Start")).toBe("@set score = 0\nThe start.<br>\n{{embed \"Bottom\"}}");
    });

    test("storylets", async () => {
        const { script } = await convert("Harlowe", ":: Start\n(link-storylet: 1)\n\n:: Cellar\n(storylet: when visits is 0 and $lamp)Dark.\n\n:: Attic\n(storylet: when $key)Dusty.");
        expect(section(script, "Start")).toBe("{{#if (visits \"Cellar\") = 0 and lamp}}[[Cellar]]<br>{{/if}}{{#if key}}[[Attic]]<br>{{/if}}");
    });

    test("(for:) and (loop:) become {{#each}}", async () => {
        const { script } = await convert("Harlowe",
            ":: Start\n(for: each _item, ...$bag)[_item; ](for: _n where _n > 2, 1, 2, 3, 4)[_n ](loop: each _x, ...(range: 1, 3))[(print: _x * 2)]");
        expect(section(script, "Start")).toBe(
            "{{#each bag}}{{this}}; {{/each}}{{#each (array 1 2 3 4)}}{{#if this > 2}}{{this}} {{/if}}{{/each}}{{#each (array 1 2 3)}}{{= this * 2}}{{/each}}");
    });

    test("a (for:) that can't be converted is left as a comment, without its hook", async () => {
        const { script, result } = await convert("Harlowe", ":: Start\n(for: it, ...$a)[x]");
        expect(section(script, "Start")).toBe("{{!-- Twine: (for: it, ...$a)[x] --}}");
        expect(result.problems.map(p => p.reason)).toEqual(["This couldn't be converted: (for:) with something other than \"each _item\" or \"_item where ...\"."]);
    });

    test("what can't be converted is left as a comment", async () => {
        const { script, result } = await convert("Harlowe", ":: Start\nHi (alert: \"x\") (set: $x to (dm: 1, 2)'s 1st)");
        expect(section(script, "Start")).toBe(
            "Hi {{!-- Twine: (alert: \"x\") --}} {{!-- Twine: (set: $x to (dm: 1, 2)'s 1st) --}}");
        expect(result.problems.map(p => p.text)).toEqual(["(alert: \"x\")", "(set: $x to (dm: 1, 2)'s 1st)"]);
    });
});

describe("SugarCube", () => {
    test("links, with setters", async () => {
        const { script } = await convert("SugarCube", ":: Start\n[[Cave]] [[Go in|Cave]] [[Go in->Cave]] [[Cave<-Enter]] [[Buy|Cave][$gold -= 5; $sword to true]]\n\n:: Cave\nDark.");
        expect(section(script, "Start")).toBe("[[Cave]] [[Go in]](Cave) [[Go in]](Cave) [[Enter]](Cave) [[Buy]](Cave, gold -= 5, sword = true)");
    });

    test("<<set>>, <<unset>> and <<run>>", async () => {
        const { script } = await convert("SugarCube", ":: Start\n<<set $gold to 10, $name = \"Ann\">><<set $gold++>><<unset $old>>\nHello.\n<<set $gold *= 2>><<run $bag.push(\"key\")>><<set $bag.delete(\"map\")>>");
        expect(section(script, "Start")).toBe(
            "@set gold = 10\n@set name = \"Ann\"\n@inc gold\n@unset old\nHello.\n{{set \"gold\" gold * 2}}{{append \"bag\" \"key\"}}{{remove \"bag\" \"map\"}}");
    });

    test("objects become an attribute for each property", async () => {
        const { script } = await convert("SugarCube", ":: Start\n<<set $player to { hp: 10, stats: { str: 3 } }>>$player.hp <<if $player[\"hp\"] gt 5 and $player.stats.str > 1>>Strong<</if>>");
        expect(section(script, "Start")).toBe(
            "@set player_hp = 10\n@set player_stats_str = 3\n{{player_hp}} {{#if player_hp > 5 and player_stats_str > 1}}Strong{{/if}}");
    });

    test("<<if>>, <<elseif>>, <<else>> and <<switch>>", async () => {
        const { script } = await convert("SugarCube", ":: Start\n<<if $a is 1 && !$b>>A<<elseif visited(\"Cave\") gte 2>>B<<else>>C<</if>> <<switch $c>><<case 1 2>>One<<default>>Other<</switch>>\n\n:: Cave\nDark.");
        expect(section(script, "Start")).toBe(
            "{{#if a = 1 and not b}}A{{else if (visits \"Cave\") >= 2}}B{{else}}C{{/if}} {{#if c = 1 or c = 2}}One{{else}}Other{{/if}}");
    });

    test("<<print>>, naked variables, <<include>> and <<goto>>", async () => {
        const { script } = await convert("SugarCube", ":: Start\n$name and _temp. <<= $gold + 1>> <<print either(\"a\", \"b\")>> <<include \"Bit\">> <<goto [[End]]>> <<timed 2s>><<goto \"End\">><</timed>>\n\n:: Bit\nA bit.\n\n:: End\nThe end.");
        expect(section(script, "Start")).toBe(
            "{{name}} and {{temp}}. {{= gold + 1}} {{random (array \"a\" \"b\")}} {{embed \"Bit\"}} {{goto \"End\"}} {{goto \"End\" after=2000}}");
    });

    test("<<link>> that sets variables and goes to a passage is a link with setters", async () => {
        const { script } = await convert("SugarCube", ":: Start\n<<link \"Buy\" \"Shop\">><<set $gold -= 5>><</link>> <<link [[Sell|Shop]]>><<set $gold += 5>><</link>> <<link \"Leave\">><<goto \"Shop\">><</link>>\n\n:: Shop\nShop.");
        expect(section(script, "Start")).toBe("[[Buy]](Shop, gold -= 5) [[Sell]](Shop, gold += 5) [[Leave]](Shop)");
    });

    test("<<link>> that stays in the passage, and <<linkreplace>>", async () => {
        const { script } = await convert("SugarCube", ":: Start\nThe box is <span id=\"box\">shut</span>. <<link \"Open\">><<replace \"#box\">>open<</replace>><</link>> <<linkreplace \"Look\">>Nothing.<</linkreplace>>");
        expect(section(script, "Start")).toBe(`The box is {{#label "box"}}shut{{/label}}. [Open](Open) {{#label "look"}}[Look](Look){{/label}}

[Open]:
{{#replace "box"}}open{{/replace}}

[Look]:
{{#replace "look"}}Nothing.{{/replace}}`);
    });

    test("form controls", async () => {
        const { script } = await convert("SugarCube", ":: Start\n<<textbox \"$name\" \"Ann\">> <<numberbox \"$age\" 20>> <<cycle \"$size\">><<option \"small\">><<option \"large\">><</cycle>> <<listbox \"$colour\">><<option \"Red\" \"red\">><</listbox>>");
        expect(section(script, "Start")).toBe(
            "{{set \"name\" \"Ann\"}}<input type=\"text\" data-attribute=\"name\" value=\"Ann\"> "
            + "{{set \"age\" 20}}<input type=\"number\" data-attribute=\"age\" value=\"20\"> "
            + "{{rotate (array \"small\" \"large\") set=\"size\"}} "
            + "<select data-attribute=\"colour\"><option value=\"red\">Red</option></select>");
    });

    test("markup", async () => {
        const { script } = await convert("SugarCube", ":: Start\n''Bold'' //italic// __under__ ==struck== ^^up^^ ~~down~~ @@color:red;Red@@ 5 * 3 a_b\n!Heading\n# One\n----\n{{{code}}} \"\"\"$raw\"\"\" /* hidden */\\\nJoined");
        expect(section(script, "Start")).toBe(
            "**Bold** _italic_ <u>under</u> <s>struck</s> <sup>up</sup> <sub>down</sub> <span style=\"color:red\">Red</span> 5 &#42; 3 a_b\n"
            + "# Heading\n1. One\n<hr>\n<code>code</code> $raw Joined");
    });

    test("special passages", async () => {
        const { script } = await convert("SugarCube", ":: Start\nThe start.\n\n:: StoryInit\n<<set $score to 0>>\n\n:: PassageHeader\nScore: $score\n\n:: PassageFooter\nThe end of the page.\n\n:: StoryMenu\n[[Start]]");
        expect(section(script, "")).toBe("@clear\nScore: {{score}}");
        expect(section(script, "Start")).toBe("@set score = 0\nThe start.<br>\n{{embed \"PassageFooter\"}}");
        expect(script).not.toContain("StoryMenu");
    });

    test("StoryBanner and StoryCaption become panels beside the story (#443)", async () => {
        const { script, result } = await convert("SugarCube", ":: Start\n<<set $gold to 5>>The start.\n\n:: StoryCaption\nGold: $gold\n[[Start]]\n\n:: StoryBanner\n''Cave''");
        expect(section(script, "")).toBe("@clear\n\n[StoryBanner]:\n**Cave**\n\n[StoryCaption]:\nGold: {{gold}}<br>\n[[Start]]");
        expect(script).not.toContain("[[StoryCaption]]:");
        expect(JSON.parse(result.files["squiffy.json"]).panels).toEqual([
            { passage: "StoryBanner", label: "Banner", position: "side" },
            { passage: "StoryCaption", label: "Status", position: "side" },
        ]);
        expect(result.problems).toEqual([
            { passage: "StoryCaption", text: "StoryCaption", reason: "This is a panel beside the story, where links don't work." },
        ]);
    });

    test("widgets become sections, which calls embed", async () => {
        const { script } = await convert("SugarCube", ":: Start\n<<say \"Ann\" \"Hello\">>\n\n:: Widgets [widget]\n<<widget \"say\">>_args[0] says: _args[1]<</widget>>");
        expect(section(script, "Start")).toBe("{{set \"args_0\" \"Ann\"}}{{set \"args_1\" \"Hello\"}}{{embed \"widget say\"}}");
        expect(section(script, "widget say")).toBe("{{args_0}} says: {{args_1}}");
    });

    test("tags().includes() is a check for the passages with the tag", async () => {
        const { script } = await convert("SugarCube", ":: Start [title]\nHi\n\n:: PassageHeader\n<<if tags().includes(\"title\")>>Title<</if>>");
        expect(section(script, "")).toBe("@clear\n{{#if (at (array \"Start\"))}}Title{{/if}}");
    });

    test("<<for>> with range becomes {{#each}}, with the item as this and the position as @index", async () => {
        const { script } = await convert("SugarCube",
            ":: Start\n<<for _i, _x range $bag>>_i: _x $bag[_i] <<if _x is \"key\">>[[Use _x|Door][$using to _x; $pos to _i]]<</if>><<set $last to _x>><</for>><<for _a range $rows>><<for _b range _a>>_b<</for>><</for>>\n\n:: Door\nD");
        expect(section(script, "Start")).toBe(
            "{{#each bag}}{{@index}}: {{this}} {{this}} {{#if this = \"key\"}}[[Use {{this}}]](Door, using = '{{this}}', pos = '{{@index}}'){{/if}}{{set \"last\" this}}{{/each}}"
            + "{{#each rows}}{{#each this}}{{this}}{{/each}}{{/each}}");
    });

    test("<<for>> through an array by position, with $list[_i] as the item", async () => {
        const { script } = await convert("SugarCube",
            ":: Start\n<<for _i to 0; _i lt $inv.length; _i++>><<link $inv[_i] \"Door\">><<set $picked = $inv[_i]>><</link>> <</for>>\n\n:: Door\nD");
        expect(section(script, "Start")).toBe("{{#each inv}}[[{{this}}]](Door, picked = '{{this}}') {{/each}}");
    });

    test("<<for>> loops that can't be converted", async () => {
        const { script, result } = await convert("SugarCube",
            ":: Start\n<<for _x range $bag>><<if _x>><<break>><</if>><</for>> <<for _c < 4>>x<</for>> <<for _x range $bag>><<set _x to 1>><</for>>");
        expect(section(script, "Start")).toBe(
            "{{!-- Twine: <<for _x range $bag>><<if _x>><<break>><</if>><</for>> --}} {{!-- Twine: <<for _c < 4>>x<</for>> --}} {{#each bag}}{{!-- Twine: <<set _x to 1>> --}}{{/each}}");
        expect(result.problems.map(p => p.reason)).toEqual([
            "This couldn't be converted: <<break>> and <<continue>>.",
            "This couldn't be converted: <<for>> loops, except ones that go through an array (with range, or from 0 to its length).",
            "This couldn't be converted: changing a loop's variable inside the loop.",
        ]);
    });

    test("a link in a loop that runs more than setters, using the loop's item, can't be converted", async () => {
        const { script, result } = await convert("SugarCube",
            ":: Start\n<<for _x range $bag>><<link _x \"Door\">><<set $picked to _x>><<goto \"Door\">><</link>><<link \"Look\">>A _x.<</link>> <<link \"Wave\">>Hi.<</link>><</for>>\n\n:: Door\nD");
        expect(section(script, "Start")).toBe(
            "{{#each bag}}[[{{this}}]](Door, picked = '{{this}}'){{!-- Twine: <<link \"Look\">>A _x.<</link>> --}} [Wave](Wave){{/each}}\n\n[Wave]:\nHi.");
        expect(result.problems.map(p => p.reason)).toEqual([
            "This couldn't be converted: a link in a loop that does more than set variables to the loop's item.",
            "This link is in a loop, and every item's link goes to the same passage, so once one has been clicked, they all have.",
        ]);
    });

    test("what can't be converted is left as a comment", async () => {
        const { script, result } = await convert("SugarCube", ":: Start\nHi <<audio \"x\" play>> <<set $x to setup.thing()>>");
        expect(section(script, "Start")).toBe("Hi {{!-- Twine: <<audio \"x\" play>> --}} {{!-- Twine: <<set $x to setup.thing()>> --}}");
        expect(result.problems.map(p => p.reason)).toEqual([
            "This couldn't be converted: audio macros.",
            "This couldn't be converted: setup.thing().",
        ]);
    });
});

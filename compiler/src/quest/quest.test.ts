import { describe, expect, test } from "vitest";
import { analyse } from "../analyse.js";
import { parseQuestGame, parseXml, QuestParseError } from "./aslx.js";
import { convertQuestGamebook, formatQuestProblems } from "./convert.js";
import type { QuestConversionOptions } from "./convert.js";

// A Quest 5.5 gamebook with the given game attributes and pages, as the editor saves it: the
// player is in the first page, and the library's defaultgame type is in the file
function gamebook(pages: string, game = "", defaults = "<clearlastpage type=\"boolean\">false</clearlastpage>") {
    const withPlayer = pages.replace(/(<object name="[^"]*">)/, "$1\n    <object name=\"player\"><inherit name=\"defaultplayer\" /></object>");
    return `<!--Saved by Quest 5.5-->
<asl version="550">
  <game name="Test Book">
    <gameid>1234</gameid>
    ${game}
  </game>
  ${withPlayer}
  <type name="defaultgame">
    <attr name="_editorstyle">gamebook</attr>
    ${defaults}
  </type>
  <function name="DoPage" parameters="page">msg (page.description)</function>
</asl>`;
}

function page(name: string, description: string, options: [string, string][] = [], extra = "") {
    const items = options.map(([key, value]) => `<item><key>${key}</key><value>${value}</value></item>`).join("");
    return `<object name="${name}">
    <description><![CDATA[${description}]]></description>
    ${options.length ? `<options type="stringdictionary">${items}</options>` : ""}
    ${extra}
  </object>`;
}

// Converts a gamebook, checks the result compiles, and returns its .squiffy file
async function convert(source: string, options: QuestConversionOptions = {}) {
    const result = convertQuestGamebook(source, options);
    const script = result.files[result.main];
    const analysis = await analyse({ script, expressions: true });
    expect(analysis.diagnostics.filter(d => d.severity == "error")).toEqual([]);
    expect(analysis.diagnostics.filter(d => d.code == "squiffy/v5-syntax")).toEqual([]);
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

const noTitle = "<showtitle type=\"boolean\">false</showtitle>";

describe("reading Quest games", () => {
    test("XML with CDATA, entities and comments", () => {
        const root = parseXml("<?xml version=\"1.0\"?><!-- a comment --><a x=\"1 &amp; 2\"><b>&lt;i&gt; &#65;&#x42;</b><c><![CDATA[<br/> & {if x:y}]]></c><d/></a>");
        const a = root.children[0];
        expect(a.attrs.x).toBe("1 & 2");
        expect(a.children.map(c => [c.name, c.text])).toEqual([["b", "<i> AB"], ["c", "<br/> & {if x:y}"], ["d", ""]]);
    });

    test("the game, its settings and pages", () => {
        const game = parseQuestGame(gamebook(
            page("Start", "Hello", [["Inner", "Go in"]], "<object name=\"Inner\"><description>Inside</description></object>") + page("Other", "There"),
            "<subtitle>A test</subtitle><clearlastpage /><customwidth type=\"int\">800</customwidth>",
        ));
        expect(game.gamebook).toBe(true);
        expect(game.aslVersion).toBe("550");
        expect(game.game.name).toBe("Test Book");
        expect(game.start).toBe("Start");
        expect(game.pages.map(p => p.name)).toEqual(["Start", "Inner", "Other"]);
        expect(game.game.attributes.get("subtitle")).toEqual({ type: "string", value: "A test" });
        expect(game.game.attributes.get("clearlastpage")).toEqual({ type: "boolean", value: true });
        expect(game.game.attributes.get("customwidth")).toEqual({ type: "number", value: 800 });
        expect(game.gameDefaults.get("clearlastpage")).toEqual({ type: "boolean", value: false });
        expect(game.pages[0].attributes.get("options")).toEqual({ type: "stringdictionary", value: [["Inner", "Go in"]] });
    });

    test("the version of Quest it was saved by", () => {
        const format = (version: string) => convertQuestGamebook(gamebook(page("Start", "Hi")).replace("version=\"550\"", `version="${version}"`)).format;
        expect(format("540")).toBe("Quest 5.4 gamebook");
        expect(format("610")).toBe("Quest Viva 6.1 gamebook");
    });

    test("a Quest Viva gamebook, which includes the library rather than having it in the file", async () => {
        const { script } = await convert(`<asl version="610">
  <include ref="GamebookCore.aslx"/>
  <game name="Viva"><showtitle type="boolean">false</showtitle></game>
  <object name="Page1"><description>Hello.</description><object name="player"><inherit name="defaultplayer" /></object></object>
</asl>`);
        expect(section(script, "Page1")).toBe("@end\nHello.");
    });

    test("a text adventure isn't converted", () => {
        const adventure = "<asl version=\"550\"><include ref=\"English.aslx\" /><include ref=\"Core.aslx\" /><game name=\"Cave\"></game><object name=\"room\"><inherit name=\"editor_room\" /></object></asl>";
        expect(() => convertQuestGamebook(adventure)).toThrow(QuestParseError);
        expect(() => convertQuestGamebook("<html></html>")).toThrow(QuestParseError);
    });
});

describe("converting gamebooks", () => {
    test("pages become sections, and options links", async () => {
        const { script, result } = await convert(gamebook(
            page("Page1", "You're at a fork in the road.", [["Page2", "Go left"], ["Page 3", "Go right"]])
            + page("Page2", "A dead end.")
            + page("Page 3", "Home again.", [["Page1", "Start over"]]),
            "", noTitle,
        ));
        expect(result.title).toBe("Test Book");
        expect(result.format).toBe("Quest 5.5 gamebook");
        expect(result.pages).toBe(3);
        expect(result.problems).toEqual([]);
        expect(script).toMatch(/^@title Test Book\n@start Page1\n/);
        expect(section(script, "Page1")).toBe("You're at a fork in the road.\n\n[[Go left]](Page2)<br>\n[[Go right]](Page 3)");
        // A page with no options is an ending
        expect(section(script, "Page2")).toBe("@end\nA dead end.");
        expect(section(script, "Page 3")).toBe("Home again.\n\n[[Start over]](Page1)");
        expect(JSON.parse(result.files["squiffy.json"]).main).toBe("story.squiffy");
    });

    test("the game's title is shown when it starts", async () => {
        const { script } = await convert(gamebook(page("Page1", "Hello."), "<subtitle>A story</subtitle><author>Someone</author>"));
        expect(section(script, "Page1")).toBe([
            "@end",
            "{{#if (visits \"Page1\") = 1}}",
            "<div class=\"quest-title\" style=\"text-align: center\"><h1>Test Book</h1><p>A story</p><p>Someone</p></div>",
            "{{/if}}",
            "Hello.",
        ].join("\n"));
    });

    test("page names that would break a link are tidied up", async () => {
        const { script } = await convert(gamebook(
            page("Start", "Hi", [["A, B", "one"], ["A B", "two"], ["[x]", "three"]]) + page("A, B", "1") + page("A B", "2") + page("[x]", "3"),
            "", noTitle,
        ));
        expect(section(script, "Start")).toBe("Hi\n\n[[one]](A B)<br>\n[[two]](A B 2)<br>\n[[three]]((x))");
    });

    test("broken links and link pages", async () => {
        const { script, result } = await convert(gamebook(
            page("Start", "Hi", [["Nowhere", "Lost"], ["Web", "Our site"]])
            + "<object name=\"Web\"><inherit name=\"link\" /><address>https://example.com/?a=1&amp;b=2</address></object>",
            "", noTitle,
        ));
        expect(section(script, "Start")).toBe("Hi\n\nLost (broken link)<br>\n<a href=\"https://example.com/?a=1&amp;b=2\" target=\"_blank\">Our site</a>");
        expect(result.pages).toBe(1);
        expect(result.problems.map(p => p.page)).toEqual(["Start"]);
    });

    test("text that Markdown would read is escaped, and line breaks are kept", async () => {
        const { script } = await convert(gamebook(
            page("Start", "Some *stars* and snake_case and _under_ [brackets] `code`<br/># not a heading<br/>- not a list<br/><br/>1. not a number<br/>@set x = 1<br/>    indented\nnew line"),
            "", noTitle,
        ));
        expect(section(script, "Start")).toBe([
            "@end",
            "Some &#42;stars&#42; and snake_case and &#95;under&#95; &#91;brackets&#93; &#96;code&#96;<br>",
            "&#35; not a heading<br>",
            "&#45; not a list",
            "",
            "1&#46; not a number<br>",
            "&#64;set x = 1<br>",
            "indented<br>",
            "new line",
        ].join("\n"));
    });

    test("pictures, videos and sounds", async () => {
        const { script, result } = await convert(gamebook(
            page("Start", "Look.", [["Next", "On"]], "<inherit name=\"picture\" /><picture>cave.png</picture>")
            + page("Next", "Listen.", [], "<sound>drip.mp3</sound><youtube>https://www.youtube.com/watch?v=dQw4w9WgXcQ</youtube>"),
            "", noTitle,
        ), { files: ["cave.png", "helper.js"] });
        // Quest stops the sounds playing when the player goes to another page
        expect(section(script, "Start")).toBe("@sound stop\n@music stop\n<img class=\"quest-picture\" src=\"cave.png\" alt=\"\">\n\nLook.\n\n[[On]](Next)");
        expect(section(script, "Next")).toBe([
            "@sound stop",
            "@music stop",
            "@sound drip.mp3",
            "@end",
            "<iframe class=\"quest-youtube\" width=\"560\" height=\"315\" src=\"https://www.youtube.com/embed/dQw4w9WgXcQ\" allowfullscreen></iframe>",
            "",
            "Listen.",
        ].join("\n"));
        expect(result.assets).toEqual(["cave.png", "drip.mp3"]);
        expect(result.problems.map(p => p.text)).toEqual(["drip.mp3"]);
        expect(JSON.parse(result.files["squiffy.json"]).exclude).toEqual(["helper.js"]);
    });

    test("a sound that carries on to the next page", async () => {
        const { script, result } = await convert(gamebook(
            page("Start", "Thunder.", [["Next", "On"]], "<sound>thunder.mp3</sound><continuesound />")
            + page("Next", "Rain.", [["Last", "On"]], "<sound>rain.mp3</sound>")
            + page("Last", "Quiet."),
            "", noTitle,
        ), { files: ["thunder.mp3", "rain.mp3"] });
        // As in Quest, the sounds stop at the start of a page unless the last page with a sound
        // was set to continue playing it
        const stop = "{{#unless continuesound}}{{stopsounds}}{{stopmusic}}{{/unless}}";
        expect(section(script, "Start")).toBe(`${stop}\n{{sound "thunder.mp3"}}{{set "continuesound" true}}\nThunder.\n\n[[On]](Next)`);
        expect(section(script, "Next")).toBe(`${stop}\n{{sound "rain.mp3"}}{{set "continuesound" false}}\nRain.\n\n[[On]](Last)`);
        expect(section(script, "Last")).toBe(`@end\n${stop}\nQuiet.`);
        expect(result.problems).toEqual([]);
    });

    test("sounds are stopped in the master section if the script for every page plays one", async () => {
        const { script } = await convert(gamebook(
            page("Start", "Hello."),
            "<roomenter type=\"script\"><![CDATA[play sound (\"step.mp3\", false, false)]]></roomenter>", noTitle,
        ));
        expect(section(script, "")).toBe("@sound stop\n@music stop\n{{sound \"step.mp3\"}}");
        expect(section(script, "Start")).toBe("@end\nHello.");
    });

    test("clearing the screen between pages", async () => {
        const { script } = await convert(gamebook(page("Start", "Hi"), "<clearlastpage />", noTitle));
        expect(section(script, "")).toBe("@clear");
    });

    test("the game's colours, fonts and width", async () => {
        const { result } = await convert(gamebook(page("Start", "Hi"), `
            <defaultbackground>Black</defaultbackground>
            <defaultforeground>White</defaultforeground>
            <defaultlinkforeground>Red</defaultlinkforeground>
            <defaultfont>'Courier New', Courier, monospace</defaultfont>
            <defaultwebfont>Press Start 2P</defaultwebfont>
            <defaultfontsize type="int">14</defaultfontsize>
            <customwidth type="int">900</customwidth>`, `${noTitle}<setcustomwidth />`));
        expect(result.files["story.css"]).toBe([
            "/* The game's colours, fonts and page width in Quest. See https://squiffystory.com/styling/ */",
            "@import url(\"https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap\");",
            "",
            ":root {",
            "    color-scheme: light;",
            "    --squiffy-background: Black;",
            "    --squiffy-text: White;",
            "    --squiffy-link: Red;",
            "    --squiffy-link-hover: Red;",
            "    --squiffy-font-family: \"Press Start 2P\", 'Courier New', Courier, monospace;",
            "    --squiffy-font-size: 14pt;",
            "    --squiffy-max-width: 900px;",
            "}",
            "",
        ].join("\n"));
    });

    test("a game that keeps the library's look has no stylesheet", async () => {
        const { result } = await convert(gamebook(page("Start", "Hi"), "<customwidth type=\"int\">900</customwidth>", `${noTitle}<setcustomwidth type="boolean">false</setcustomwidth>`));
        expect(result.files["story.css"]).toBeUndefined();
    });
});

describe("the text processor", () => {
    async function text(description: string, pages = "") {
        const { script, result } = await convert(gamebook(page("Start", description, [["Other", "On"]]) + page("Other", "Other page.") + pages, "", noTitle));
        const s = section(script, "Start");
        return { text: s.substring(0, s.lastIndexOf("\n\n[[On]](Other)")), script, problems: result.problems };
    }

    test("conditions", async () => {
        expect((await text("{if lamp:Light.}{if not lamp:Dark.}")).text).toBe("{{#if lamp}}Light.{{/if}}{{#if not lamp}}Dark.{{/if}}");
        expect((await text("{if score>5:Good}{if score<>2:x}{if mood=happy:y}")).text)
            .toBe("{{#if score > 5}}Good{{/if}}{{#if score != 2}}x{{/if}}{{#if mood = \"happy\"}}y{{/if}}");
        expect((await text("{if game.lamp:a}{if Other.visited:b}{if player.strong:c}")).text)
            .toBe("{{#if lamp}}a{{/if}}{{#if (seen \"Other\")}}b{{/if}}{{#if player_strong}}c{{/if}}");
        // Names Squiffy uses itself get an underscore
        expect((await text("{if seen:a}")).text).toBe("{{#if seen_}}a{{/if}}");
        const missing = await text("{if Nowhere.visited:a}");
        expect(missing.text).toBe("{{#if false}}a{{/if}}");
        expect(missing.problems).toHaveLength(1);
    });

    test("once and notfirst", async () => {
        expect((await text("{once:First time.}{notfirst:Again.}")).text)
            .toBe("{{#if (visits \"Start\") = 1}}First time.{{/if}}{{#if (visits \"Start\") > 1}}Again.{{/if}}");
    });

    test("links to pages", async () => {
        expect((await text("Go {page:Other} or {page:Other:there} or {command:Other:here}.")).text)
            .toBe("Go [[Other]] or [[there]](Other) or [[here]](Other).");
        const broken = await text("{page:Nowhere:lost}");
        expect(broken.text).toBe("lost");
        expect(broken.problems).toHaveLength(1);
    });

    test("formatting, images and counters", async () => {
        expect((await text("{b:bold} {i:it} {u:under} {s:struck} {colour:red:Red} {back:yellow:Bg: here}")).text)
            .toBe("**bold** _it_ <u>under</u> <s>struck</s> <span style=\"color: red\">Red</span> <span style=\"background-color: yellow\">Bg: here</span>");
        expect((await text("{img:map.png} You have {counter:gold} gold. {game.name}, {player.strength}")).text)
            .toBe("<img src=\"map.png\" alt=\"\"> You have {{= gold + 0}} gold. {{name}}, {{player_strength}}");
    });

    test("random text", async () => {
        expect((await text("{random:red:green:{b:blue}}")).text).toBe("{{random (array \"red\" \"green\" \"**blue**\")}}");
    });

    test("popups become passages", async () => {
        const { text: t, script } = await text("A {popup:key:An old key.} here.");
        expect(t).toBe("A [key](key) here.");
        expect(section(script, "Start")).toContain("[key]:\nAn old key.");
    });

    test("commands Quest doesn't know are shown as they are", async () => {
        expect((await text("{hello} {if broken}")).text).toBe("&#123;hello&#125; &#123;if broken&#125;");
        // Quest shows everything after a { with no } as it is
        expect((await text("{b:bold} {if lamp:Light. {once:Hi}")).text).toBe("**bold** &#123;if lamp:Light. &#123;once:Hi&#125;");
    });

    test("expressions are kept in comments", async () => {
        const { text: t, problems } = await text("{either lamp:Light|Dark}");
        expect(t).toBe("{{!-- Quest: {either lamp:Light|Dark} --}}");
        expect(problems).toHaveLength(1);
    });
});

test("the list of problems", () => {
    const result = convertQuestGamebook(gamebook(
        page("Start", "{either x:a}", [["Gone", "Lost"]]),
        "<roomenter type=\"script\">JS.alert (\"hi\")</roomenter>", noTitle,
    ));
    expect(formatQuestProblems(result, "test.aslx")).toBe(`Converted test.aslx (Quest 5.5 gamebook) to Squiffy: 1 page.

3 things couldn't be converted exactly. Where something couldn't be converted at all, the story has the
Quest code in a comment, {{!-- Quest: ... --}}, so you can search for "Quest:" to find them.

The whole story:
  JS.alert ("hi")
    This couldn't be converted: Squiffy can't run Quest's JavaScript. It's in the script that runs on every page, in the master section, [[]].
Start:
  {either x:a}
    This couldn't be converted: Quest expressions in text can't be converted yet.
  Lost
    This option goes to a page called "Gone", which isn't in the game. Quest shows it as a broken link, so it isn't a link here.
`);
});

describe("scripts", () => {
    // A page whose script runs before its text, as a script and text page does
    function scriptPage(name: string, script: string, description = "", options: [string, string][] = [], type = "scripttext") {
        return page(name, description, options, `<inherit name="${type}" /><script type="script"><![CDATA[${script}]]></script>`);
    }

    async function run(pages: string, game = "") {
        const { script, result } = await convert(gamebook(pages + page("End", "The end."), game, noTitle));
        return { script, problems: result.problems };
    }

    test("flags, counters, attributes and text", async () => {
        const { script, problems } = await run(scriptPage("Start", `
            SetFlagOn ("lamp")
            SetFlagOff ("dark")
            SetCounter ("gold", 10)
            IncreaseCounter ("gold")
            DecreaseCounter ("hp")
            ChangeCounter ("gold", 5)
            game.name = "Bob"
            player.strength = player.strength + 1
            set (game, "mood", "happy")
            msg ("You have " + game.gold + " gold, {b:" + game.name + "}.")
            msg ("Line one.<br/>Line two.")`, "Text.", [["End", "On"]]));
        expect(section(script, "Start")).toBe([
            "{{set \"lamp\" true}}",
            "{{set \"dark\" false}}",
            "{{set \"gold\" 10}}",
            "{{inc \"gold\"}}",
            "{{dec \"hp\"}}",
            "{{inc \"gold\" 5}}",
            "{{set \"name\" \"Bob\"}}",
            "{{set \"player_strength\" player_strength + 1}}",
            "{{set \"mood\" \"happy\"}}",
            "You have {{gold}} gold, &#123;b:{{name}}&#125;.<br>",
            "Line one.<br>Line two.<br>",
            "Text.",
            "",
            "[[On]](End)",
        ].join("\n"));
        expect(problems).toEqual([]);
    });

    test("conditions", async () => {
        const { script } = await run(scriptPage("Start", `
            if (GetBoolean(game, "lamp") and not game.dark) {
              msg ("Light.")
            }
            else if (GetInt(game, "gold") >= 10 or HasSeenPage(End)) {
              msg ("Rich.")
            }
            else if (RandomChance(35)) {
              msg ("Lucky.")
            }
            else {
              msg ("Neither.")
            }
            switch (game.mood) {
              case ("happy", "glad") {
                msg ("Smile.")
              }
              default {
                msg ("Frown.")
              }
            }`, "", [["End", "On"]]));
        expect(section(script, "Start")).toBe([
            // Each msg is a line of its own, as in Quest
            "{{#if lamp and not dark}}",
            "Light.<br>",
            "{{else if gold >= 10 or (seen \"End\")}}",
            "Rich.<br>",
            "{{else if (random (array 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20)) <= 7}}",
            "Lucky.<br>",
            "{{else}}",
            "Neither.<br>",
            "{{/if}}",
            "{{#if mood = \"happy\" or mood = \"glad\"}}",
            "Smile.<br>",
            "{{else}}",
            "Frown.",
            "{{/if}}",
            "",
            "[[On]](End)",
        ].join("\n"));
    });

    test("firsttime", async () => {
        const { script } = await run(scriptPage("Start", `
            firsttime {
              msg ("Hello.")
            }
            otherwise {
              msg ("Hello again.")
            }
            if (game.lamp) {
              firsttime {
                msg ("The lamp is on.")
              }
            }`, "", [["End", "On"]]));
        // At the top of a script, the first time is the first visit. Anywhere else, an attribute
        // remembers it.
        expect(section(script, "Start")).toBe([
            "{{#if (visits \"Start\") = 1}}",
            "Hello.<br>",
            "{{else}}",
            "Hello again.<br>",
            "{{/if}}",
            "{{#if lamp}}",
            "{{#unless firsttime_1}}",
            "{{set \"firsttime_1\" true}}",
            "The lamp is on.",
            "{{/unless}}",
            "{{/if}}",
            "",
            "[[On]](End)",
        ].join("\n"));
    });

    test("moving to another page", async () => {
        const { script, problems } = await run(
            scriptPage("Start", "if (game.lamp) {\n  MovePlayer (Room 551 Weather1)\n}\ngame.next = End", "", [["Room 551 Weather1", "On"]], "script")
            + page("Room 551 Weather1", "Rain.", [["Hall", "Next"]])
            + scriptPage("Hall", "MovePlayer (game.next)", "The hall.", [["End", "On"]]),
        );
        // A page that only runs its script shows nothing else
        expect(section(script, "Start")).toBe("{{#if lamp}}\n{{goto \"Room 551 Weather1\"}}\n{{/if}}\n{{set \"next\" \"End\"}}");
        // A page in an attribute might be this one, which Quest doesn't move to
        expect(section(script, "Hall")).toBe("{{#unless (at next)}}{{goto next}}{{/unless}}\nThe hall.\n\n[[On]](End)");
        expect(problems.map(p => p.page)).toEqual(["Hall"]);
    });

    test("links that scripts add and remove", async () => {
        const { script } = await run(
            page("Start", "A fork.", [["Left", "Go left"], ["Right", "Go right"]])
            + scriptPage("Left", "RemovePageLink (Start, Left)\nAddPageLink (Start, Secret, \"Go through the door\")\nAddPageLink (this, End, \"Leave\")\nAddPageLink (player.parent, End, \"Run\")", "", [["Start", "Back"]])
            + page("Right", "Nothing here.", [["Start", "Back"]])
            + page("Secret", "A secret room."),
        );
        // Links that start on a page are shown when the story starts
        expect(section(script, "Start")).toBe([
            "{{#if (visits \"Start\") = 1}}",
            "{{set \"link_Start_Left\" true}}",
            "{{/if}}",
            "A fork.",
            "",
            "{{#if link_Start_Left}}",
            "[[Go left]](Left)<br>",
            "{{/if}}",
            "[[Go right]](Right)<br>",
            "{{#if link_Start_Secret}}",
            "[[Go through the door]](Secret)",
            "{{/if}}",
        ].join("\n"));
        // A link that can have more than one text shows the one it was given
        expect(section(script, "Left")).toBe([
            "{{set \"link_Start_Left\" false}}",
            "{{set \"link_Start_Secret\" true}}",
            "{{set \"link_Left_End\" 1}}",
            "{{set \"link_Left_End\" 2}}",
            "",
            "[[Back]](Start)<br>",
            "{{#if link_Left_End = 1}}",
            "[[Leave]](End)<br>",
            "{{/if}}",
            "{{#if link_Left_End = 2}}",
            "[[Run]](End)",
            "{{/if}}",
        ].join("\n"));
    });

    test("asking for input", async () => {
        const { script } = await run(scriptPage("Start", "msg (\"What's your name?\")\nGetInput () {\n  game.name = result\n  msg (\"Hello, \" + result + \".\")\n}", "", [["End", "On"]]));
        // Squiffy keeps what's typed once the player goes to another section, so the rest of the
        // script is in a section of its own, which has the page's links too
        expect(section(script, "Start")).toBe([
            "What's your name?<br>",
            "<input type=\"text\" data-attribute=\"input\"><br>",
            "[[Continue]](Start continued)",
            "",
            "[[On]](End)",
        ].join("\n"));
        expect(section(script, "Start continued")).toBe([
            "{{set \"name\" input}}",
            "Hello, {{input}}.",
            "",
            "[[On]](End)",
        ].join("\n"));
    });

    test("sounds, music and stopping it", async () => {
        const { script, problems } = await run(scriptPage("Start", `
            play sound ("door.mp3", false, false)
            msg ("Creak.")
            play sound ("theme.mp3", true, true)
            stop sound`, "", [["End", "On"]]));
        expect(section(script, "Start")).toBe([
            "@sound stop",
            "@music stop",
            "{{sound \"door.mp3\"}}",
            "Creak.",
            "{{music \"theme.mp3\"}}",
            "{{stopsounds}}{{stopmusic}}",
            "",
            "[[On]](End)",
        ].join("\n"));
        expect(section(script, "End")).toBe("@sound stop\n@music stop\n@end\nThe end.");
        expect(problems).toEqual([]);
    });

    test("pictures, sounds and how the page looks", async () => {
        const { script } = await run(scriptPage("Start", `
            ClearScreen
            picture ("map.png")
            play sound ("rain.mp3", false, true)
            PrintCentered ("<b>Chapter 1</b>")
            TextFX_Typewriter ("It was a dark night.", 50)
            SetBackgroundColour ("Black")
            SetWebFontName ("Press Start 2P")
            DisplayHttpLink ("Our site", "http://example.com", true)`, "", [["End", "On"]]));
        expect(section(script, "Start")).toBe([
            "@sound stop",
            "@music stop",
            "@clear",
            "<img src=\"map.png\" alt=\"\"><br>",
            "{{music \"rain.mp3\"}}",
            "<span style=\"display: block; text-align: center\">**Chapter 1**</span><br>",
            "{{#animate \"typewriter\" interval=50}}It was a dark night.{{/animate}}<br>",
            "<style>:root { color-scheme: light; --squiffy-background: Black; }</style><br>",
            "<style>@import url(\"https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap\");:root { color-scheme: light; --squiffy-font-family: \"Press Start 2P\"; }</style><br>",
            "<a href=\"https://example.com\" target=\"_blank\">Our site</a>",
            "",
            "[[On]](End)",
        ].join("\n"));
    });

    test("what can't be converted is kept in comments", async () => {
        const { script, problems } = await run(scriptPage("Start", `
            msg ("Before.")
            ClearScreen
            JS.eval ("alert(1)")
            list add (game.items, "key")
            if (Foo(1)) {
              msg ("x")
            }
            MovePlayer (Nowhere)
            msg (`, "", [["End", "On"]]));
        expect(section(script, "Start")).toBe([
            "Before.",
            "{{!-- Quest: ClearScreen --}}",
            "{{!-- Quest: JS.eval (\"alert(1)\") --}}",
            "{{!-- Quest: list add (game.items, \"key\") --}}",
            "{{!-- Quest: if (Foo(1)) { msg (\"x\") } --}}",
            "{{!-- Quest: MovePlayer (Nowhere) --}}",
            "{{!-- Quest: msg ( --}}",
            "",
            "[[On]](End)",
        ].join("\n"));
        expect(problems.map(p => p.reason)).toEqual([
            "This couldn't be converted: Squiffy can only clear the screen before a section is shown.",
            "This couldn't be converted: Squiffy can't run Quest's JavaScript.",
            "This couldn't be converted: Squiffy has nothing like list add.",
            "This couldn't be converted: Squiffy has nothing like Foo.",
            "This couldn't be converted: there's no page called \"Nowhere\".",
            "This couldn't be converted: Squiffy couldn't read this Quest script.",
        ]);
    });

    test("the script that runs on every page", async () => {
        const { script } = await run(page("Start", "Hi.", [["End", "On"]]), `<roomenter type="script"><![CDATA[
            ClearScreen
            IncreaseCounter ("turns")
            firsttime {
              msg ("Welcome.")
            }
            if (player.parent = End) {
              msg ("Nearly done.")
            }
            if (game.won) {
              MovePlayer (End)
            }]]></roomenter>`);
        expect(section(script, "")).toBe([
            "@clear",
            "{{inc \"turns_\"}}",
            "{{#unless firsttime_1}}",
            "{{set \"firsttime_1\" true}}",
            "Welcome.<br>",
            "{{/unless}}",
            "{{#if (at \"End\")}}",
            "Nearly done.",
            "{{/if}}",
            // It runs on End too, so it only goes there from somewhere else
            "{{#if won}}",
            "{{#unless (at \"End\")}}{{goto \"End\"}}{{/unless}}",
            "{{/if}}",
        ].join("\n"));
    });
});

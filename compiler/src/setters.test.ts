import { describe, expect, test } from "vitest";
import { convertSetter, convertSetters } from "./setters.js";

describe("convertSetter", () => {
    test.each([
        // Text is quoted
        ["weapon = sword", "weapon = \"sword\""],
        ["greeting=Hello there", "greeting=\"Hello there\""],
        ["name = Bob's", "name = \"Bob's\""],
        ["quote = say \"hi\"", "quote = 'say \"hi\"'"],
        // @name becomes name
        ["best = @score", "best = score"],
        ["gold += @price", "gold += price"],
        ["x = @and", "x = [and]"],
        ["x = @my attr", "x = [my attr]"],
        // Numbers are as Squiffy 6 read them
        ["gold = 10", "gold = 10"],
        ["gold = -2.5", "gold = -2.5"],
        ["gold = 05", "gold = 05"],
        ["gold = 1e3", "gold = 1000"],
        ["gold = 1.50", "gold = 1.50"],
        // Unchanged
        ["flag = true", "flag = true"],
        ["flag = false", "flag = false"],
        ["gold += 5", "gold += 5"],
        ["gold /= 2", "gold /= 2"],
        ["has_key", "has_key"],
        ["not has_key", "not has_key"],
        ["greeting := Hello, {{name}}!", "greeting := Hello, {{name}}!"],
        // Whitespace around the setter is kept
        [" weapon = sword ", " weapon = \"sword\" "],
        // Names can have letters from any language in them (#660)
        ["Zähler = drei", "Zähler = \"drei\""],
        ["Zähler += @Josué", "Zähler += Josué"],
        ["mönjääkäsissä", "mönjääkäsissä"],
        ["not mönjääkäsissä", "not mönjääkäsissä"],
    ])("%j -> %j", (input, expected) => {
        expect(convertSetter(input)).toEqual({ text: expected });
    });

    test("prefers single quotes inside set=\"...\"", () => {
        expect(convertSetter("weapon = sword", { preferSingleQuotes: true })).toEqual({ text: "weapon = 'sword'" });
        expect(convertSetter("name = Bob's", { preferSingleQuotes: true })).toEqual({ text: "name = \"Bob's\"" });
    });

    test.each([
        ["x = ", "it has no value"],
        ["= 5", "no attribute name"],
        ["text = it's \"both\"", "both kinds of quote"],
        ["path = C:\\temp", "backslash"],
        ["gold > 5", "isn't an attribute name"],
        ["x = Infinity", "isn't a plain number"],
    ])("can't convert %j", (input, reason) => {
        const result = convertSetter(input);
        expect("problem" in result && result.problem).toContain(reason);
    });
});

describe("convertSetters", () => {
    test("converts @set, links and set=", () => {
        const script = [
            "@set start = here",
            "[[start]]:",
            "@set weapon = sword",
            "@set gold = 10",
            "@inc count",
            "@unset weapon",
            "[[Buy]](shop, gold -= @price, message = Hi, there) and [buy](haggle, x=1, y = cheap)",
            "[[Next]](>, done = yes)",
            "{{section \"end\" text=\"End\" set=\"title = The End, finished\"}}",
            "{{passage \"p\" set='who = \\'Bob\\''}}",
            "",
            "[haggle]:",
            "@set mood = grumpy",
            "",
            "[[shop]]:",
            "    squiffy.set(\"x\", \"y\");",
            "[[unnamed, x = y]]",
        ].join("\n");
        const result = convertSetters(script);
        expect(result.problems).toEqual([]);
        expect(result.script.split("\n")).toEqual([
            "@set start = \"here\"",
            "[[start]]:",
            "@set weapon = \"sword\"",
            "@set gold = 10",
            "@inc count",
            "@unset weapon",
            "[[Buy]](shop, gold -= price, message = \"Hi\", there) and [buy](haggle, x=1, y = \"cheap\")",
            "[[Next]](>, done = \"yes\")",
            "{{section \"end\" text=\"End\" set=\"title = 'The End', finished\"}}",
            // Squiffy 6 kept the quotes as part of the text
            "{{passage \"p\" set='who = \"\\'Bob\\'\"'}}",
            "",
            "[haggle]:",
            "@set mood = \"grumpy\"",
            "",
            "[[shop]]:",
            "    squiffy.set(\"x\", \"y\");",
            "[[unnamed, x = y]]",
        ]);
        expect(result.converted).toBe(9);
    });

    test("leaves setters it can't convert, and lists them", () => {
        const result = convertSetters("[[start]]:\n@set path = C:\\temp\n@set a = b");
        expect(result.script).toBe("[[start]]:\n@set path = C:\\temp\n@set a = \"b\"");
        expect(result.problems).toEqual([{ line: 2, text: "path = C:\\temp", reason: expect.stringContaining("backslash") }]);
        expect(result.converted).toBe(1);
    });

    test("keeps CRLF line endings", () => {
        expect(convertSetters("[[start]]:\r\n@set a = b\r\n").script).toBe("[[start]]:\r\n@set a = \"b\"\r\n");
    });

    test("does nothing to a story with no setters to change", () => {
        const script = "[[start]]:\n@set gold = 10\nHello [[next]].\n\n[[next]]:\nBye.";
        expect(convertSetters(script)).toEqual({ script, converted: 0, problems: [] });
    });
});

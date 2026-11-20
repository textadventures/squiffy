import { expect, test, describe } from "vitest";
import { rewriteDisplayExpression, rewriteInfixArguments, rewriteInfixCondition, rewriteInfixExpressions, rewriteValueExpression, splitSetters } from "./infixExpressions.js";

describe("rewriteInfixCondition", () => {
    test.each([
        ["gender = \"male\"", "(eq gender \"male\")"],
        ["gender == \"male\"", "(eq gender \"male\")"],
        ["gender != \"male\"", "(ne gender \"male\")"],
        ["score > 100", "(gt score 100)"],
        ["score < 100", "(lt score 100)"],
        ["score >= 100", "(gte score 100)"],
        ["score <= 100", "(lte score 100)"],
        ["a and b", "(and a b)"],
        ["a && b", "(and a b)"],
        ["a or b", "(or a b)"],
        ["a || b", "(or a b)"],
        ["not a", "(not a)"],
        ["!a", "(not a)"],
        ["! a", "(not a)"],
        ["not not a", "(not (not a))"],
    ])("operator: %s", (input, expected) => {
        expect(rewriteInfixCondition(input)).toBe(expected);
    });

    test.each([
        ["score>100", "(gt score 100)"],
        ["gender=\"male\"", "(eq gender \"male\")"],
        ["a&&b||c", "(or (and a b) c)"],
        ["score>=-5", "(gte score -5)"],
    ])("no spaces: %s", (input, expected) => {
        expect(rewriteInfixCondition(input)).toBe(expected);
    });

    test.each([
        ["a and b and c", "(and a b c)"],
        ["a or b or c", "(or a b c)"],
        ["a or b and c", "(or a (and b c))"],
        ["a and b or c", "(or (and a b) c)"],
        ["score > 100 and has_key", "(and (gt score 100) has_key)"],
        ["x = 1 or y != 2 and z", "(or (eq x 1) (and (ne y 2) z))"],
        ["not a and b", "(and (not a) b)"],
        ["not a = b", "(not (eq a b))"],
        ["not gender = \"male\"", "(not (eq gender \"male\"))"],
        ["not score > 100 and has_key", "(and (not (gt score 100)) has_key)"],
        ["!a = b", "(not (eq a b))"],
        ["not a = b or not c", "(or (not (eq a b)) (not c))"],
        ["(not a) = b", "(eq (not a) b)"],
        ["a = (not b)", "(eq a (not b))"],
        ["not (seen \"intro\") or count >= 3", "(or (not (seen \"intro\")) (gte count 3))"],
    ])("precedence: %s", (input, expected) => {
        expect(rewriteInfixCondition(input)).toBe(expected);
    });

    test.each([
        ["(a or b) and c", "(and (or a b) c)"],
        ["not (a = 1)", "(not (eq a 1))"],
        ["((a))", null],
        ["((a or b)) and c", "(and (or a b) c)"],
        ["(score > 100) = true", "(eq (gt score 100) true)"],
    ])("grouping: %s", (input, expected) => {
        expect(rewriteInfixCondition(input)).toBe(expected);
    });

    test.each([
        ["name = 'Bob'", "(eq name 'Bob')"],
        ["name = \"a > b and c\"", "(eq name \"a > b and c\")"],
        ["done = true", "(eq done true)"],
        ["x = null", "(eq x null)"],
        ["score > 1.5", "(gt score 1.5)"],
        ["player.score > 10", "(gt player.score 10)"],
        ["[my score] > 10", "(gt [my score] 10)"],
        ["@index > 0", "(gt @index 0)"],
        ["(length \"rounds\") > 0", "(gt (length \"rounds\") 0)"],
        ["(contains \"inventory\" \"key\") and door = \"open\"", "(and (contains \"inventory\" \"key\") (eq door \"open\"))"],
        ["(and a b) or c", "(or (and a b) c)"],
        ["(at (array \"a\" \"b\")) or x", "(or (at (array \"a\" \"b\")) x)"],
        ["(get (concat a b)) = 1", "(eq (get (concat a b)) 1)"],
        ["(lookup obj key=1) = 2", "(eq (lookup obj key=1) 2)"],
        ["(seen (x)) and y", "(and (seen x) y)"],
    ])("operands: %s", (input, expected) => {
        expect(rewriteInfixCondition(input)).toBe(expected);
    });

    test.each([
        "has_key",
        " has_key ",
        "(eq gender \"male\")",
        "(and (gt score 100) has_key)",
        "(seen \"intro\")",
        "(at (array \"start\" \"other\"))",
        "x includeZero=true",
        "(gt (length \"rounds\") 0)",
        "\"string\"",
        "42",
    ])("passes through prefix syntax: %s", (input) => {
        expect(rewriteInfixCondition(input)).toBeNull();
    });

    test("not with prefix syntax is equivalent", () => {
        expect(rewriteInfixCondition("(not game_over)")).toBe("(not game_over)");
    });

    test("infix inside a helper's arguments", () => {
        expect(rewriteInfixCondition("(foo (a > 1))")).toBe("(foo (gt a 1))");
    });

    test.each([
        ["score >", "expected a value after '>'"],
        ["a and", "expected a value after 'and'"],
        ["a or", "expected a value after 'or'"],
        ["not", "expected a value after 'not'"],
        ["> 100", "expected a value before '>'"],
        ["and b", "expected a value before 'and'"],
        ["(a > 1", "expected ')' but found end of expression"],
        ["a > 1)", "unexpected ')'"],
        ["a > 1 b", "unexpected 'b'"],
        ["1 < x < 10", "comparisons can't be chained"],
        ["a = = b", "expected a value before '='"],
        ["a > () ", "unexpected ')'"],
        ["a = not b", "'not' must be inside parentheses here, e.g. (not value)"],
        ["a = !b", "'!' must be inside parentheses here, e.g. (!value)"],
    ])("error: %s", (input, message) => {
        expect(() => rewriteInfixCondition(input)).toThrow(message);
    });

    test.each([
        ["a + b > 1", "(gt (add a b) 1)"],
        ["a - b > 1", "(gt (sub a b) 1)"],
        ["a * b > 1", "(gt (mul a b) 1)"],
        ["a / b > 1", "(gt (div a b) 1)"],
        ["a % b = 1", "(eq (mod a b) 1)"],
        ["-a < 0", "(lt (sub 0 a) 0)"],
        ["- a < 0", "(lt (sub 0 a) 0)"],
        ["gold >= price * 2", "(gte gold (mul price 2))"],
    ])("arithmetic operator: %s", (input, expected) => {
        expect(rewriteInfixCondition(input)).toBe(expected);
    });

    test.each([
        ["a + b * c = 1", "(eq (add a (mul b c)) 1)"],
        ["a * b + c = 1", "(eq (add (mul a b) c) 1)"],
        ["a - b - c = 1", "(eq (sub (sub a b) c) 1)"],
        ["a / b / c = 1", "(eq (div (div a b) c) 1)"],
        ["a % b * c = 1", "(eq (mul (mod a b) c) 1)"],
        ["(a + b) * c = 1", "(eq (mul (add a b) c) 1)"],
        ["a * (b + c) = 1", "(eq (mul a (add b c)) 1)"],
        ["-a * b = 1", "(eq (mul (sub 0 a) b) 1)"],
        ["-(a + b) = 1", "(eq (sub 0 (add a b)) 1)"],
        ["a - -b = 1", "(eq (sub a (sub 0 b)) 1)"],
        ["a + b > c and not d - 1 = 0", "(and (gt (add a b) c) (not (eq (sub d 1) 0)))"],
        ["a > b + 1 or c", "(or (gt a (add b 1)) c)"],
        ["(length \"items\") * 2 > 3", "(gt (mul (length \"items\") 2) 3)"],
    ])("arithmetic precedence: %s", (input, expected) => {
        expect(rewriteInfixCondition(input)).toBe(expected);
    });

    test.each([
        ["a+b>1", "(gt (add a b) 1)"],
        ["a*b>1", "(gt (mul a b) 1)"],
        ["a%b>1", "(gt (mod a b) 1)"],
        ["a -1 > 0", "(gt (sub a 1) 0)"],
        ["a - 1 > 0", "(gt (sub a 1) 0)"],
        ["a -b > 0", "(gt (sub a b) 0)"],
        ["a /b > 0", "(gt (div a b) 0)"],
        ["a * -1 > 0", "(gt (mul a -1) 0)"],
        ["a > -1", "(gt a -1)"],
        ["1.5 * a > 0", "(gt (mul 1.5 a) 0)"],
    ])("arithmetic spacing: %s", (input, expected) => {
        expect(rewriteInfixCondition(input)).toBe(expected);
    });

    test.each([
        ["my-score > 1", "(gt my-score 1)"],
        ["a-b > 1", "(gt a-b 1)"],
        ["../score > 1", "(gt ../score 1)"],
        ["player/score > 1", "(gt player/score 1)"],
        ["[gold + silver] > 1", "(gt [gold + silver] 1)"],
        ["name = \"a + b\"", "(eq name \"a + b\")"],
    ])("- and / inside names and paths: %s", (input, expected) => {
        expect(rewriteInfixCondition(input)).toBe(expected);
    });

    test.each([
        "my-score",
        "(gt x -1)",
        "(foo a -1)",
        "(x -1)",
    ])("passes through prefix syntax with -: %s", (input) => {
        expect(rewriteInfixCondition(input)).toBeNull();
    });

    test.each([
        ["a +", "expected a value after '+'"],
        ["a * > 1", "expected a value before '>'"],
        ["* a", "expected a value before '*'"],
        ["a + + b", "expected a value before '+'"],
        ["-", "expected a value after '-'"],
        ["(a + b", "expected ')' but found end of expression"],
    ])("arithmetic error: %s", (input, message) => {
        expect(() => rewriteInfixCondition(input)).toThrow(message);
    });

    test("error message includes the condition", () => {
        expect(() => rewriteInfixCondition(" score > ")).toThrow("Invalid condition \"score >\": expected a value after '>'");
    });

    test("malformed prefix syntax is left for Handlebars to report", () => {
        expect(rewriteInfixCondition("a b")).toBeNull();
        expect(rewriteInfixCondition("(eq a")).toBeNull();
        expect(rewriteInfixCondition("\"unterminated")).toBeNull();
    });
});

describe("rewriteInfixArguments", () => {
    test.each([
        ["\"gold\" gold + price * 2", "\"gold\" (add gold (mul price 2))"],
        ["\"gold\" (gold + price) * 2", "\"gold\" (mul (add gold price) 2)"],
        ["\"name\" name + \" the Brave\"", "\"name\" (add name \" the Brave\")"],
        ["\"x\" -y", "\"x\" (sub 0 y)"],
        ["\"x\" a > b", "\"x\" (gt a b)"],
        ["\"x\" a and b", "\"x\" (and a b)"],
        ["\"x\" (length \"items\") - 1", "\"x\" (sub (length \"items\") 1)"],
    ])("%s", (input, expected) => {
        expect(rewriteInfixArguments(input)).toBe(expected);
    });

    test.each([
        "\"score\" 100",
        "\"score\" -1",
        "\"name\" \"Alice\"",
        "\"items\" (array \"a\" \"b\")",
        "\"x\" (add a b)",
        "\"counter\"",
        "\"x\" my-score",
    ])("passes through prefix syntax: %s", (input) => {
        expect(rewriteInfixArguments(input)).toBeNull();
    });

    test.each([
        ["\"gold\" gold +", "Invalid expression \"\"gold\" gold +\": expected a value after '+'"],
        ["\"gold\" gold + 1 x", "unexpected 'x'"],
        ["\"gold\" + 1", "expected a value before '+'"],
    ])("error: %s", (input, message) => {
        expect(() => rewriteInfixArguments(input)).toThrow(message);
    });
});

describe("rewriteDisplayExpression", () => {
    test.each([
        ["price * 2", "mul price 2"],
        ["gold + price * 2", "add gold (mul price 2)"],
        ["a > b", "gt a b"],
        ["gold", "gold"],
        [" (gold) ", "gold"],
        ["(length \"items\")", "length \"items\""],
        ["-gold", "sub 0 gold"],
    ])("%s", (input, expected) => {
        expect(rewriteDisplayExpression(input)).toBe(expected);
    });

    test.each([
        ["", "expected a value"],
        ["a +", "expected a value after '+'"],
        ["a b", "unexpected 'b'"],
        ["5", "expected an attribute or a calculation"],
        ["\"text\"", "expected an attribute or a calculation"],
        ["\"unterminated", "unterminated string"],
    ])("error: %s", (input, message) => {
        expect(() => rewriteDisplayExpression(input)).toThrow(message);
    });
});

describe("rewriteInfixExpressions", () => {
    test("#if", () => {
        expect(rewriteInfixExpressions("{{#if score > 100 and has_key}}yes{{/if}}"))
            .toBe("{{#if (and (gt score 100) has_key)}}yes{{/if}}");
    });

    test("#unless", () => {
        expect(rewriteInfixExpressions("{{#unless not (seen \"intro\") or count >= 3}}x{{/unless}}"))
            .toBe("{{#unless (or (not (seen \"intro\")) (gte count 3))}}x{{/unless}}");
    });

    test("else if / else unless", () => {
        expect(rewriteInfixExpressions("{{#if a = 1}}one{{else if a = 2}}two{{else unless a = 3}}not three{{else}}three{{/if}}"))
            .toBe("{{#if (eq a 1)}}one{{else if (eq a 2)}}two{{else unless (eq a 3)}}not three{{else}}three{{/if}}");
    });

    test("whitespace control", () => {
        expect(rewriteInfixExpressions("{{~#if a > 1~}}x{{~else if a < 0 ~}}y{{/if}}"))
            .toBe("{{~#if (gt a 1)~}}x{{~else if (lt a 0)~}}y{{/if}}");
    });

    test("!x with no space after the helper name", () => {
        expect(rewriteInfixExpressions("{{#if !x}}y{{/if}}")).toBe("{{#if (not x)}}y{{/if}}");
    });

    test("}} inside a string", () => {
        expect(rewriteInfixExpressions("{{#if x = \"}}\"}}y{{/if}}")).toBe("{{#if (eq x \"}}\")}}y{{/if}}");
    });

    test("leaves prefix syntax and other text untouched", () => {
        const text = "Score: {{score}}. {{#if (gt  score 100)}}High{{/if}} {{#each items}}{{this}}{{/each}} a > b";
        expect(rewriteInfixExpressions(text)).toBe(text);
    });

    test("leaves escaped mustaches untouched", () => {
        expect(rewriteInfixExpressions("\\{{#if a > 1}}")).toBe("\\{{#if a > 1}}");
        expect(rewriteInfixExpressions("\\\\{{#if a > 1}}x{{/if}}")).toBe("\\\\{{#if (gt a 1)}}x{{/if}}");
    });

    test("doesn't match helpers that only start with if", () => {
        expect(rewriteInfixExpressions("{{#iffy a > 1}}")).toBe("{{#iffy a > 1}}");
    });

    test("multiline", () => {
        expect(rewriteInfixExpressions("{{#if a > 1\n  and b}}\nx\n{{/if}}")).toBe("{{#if (and (gt a 1) b)}}\nx\n{{/if}}");
    });

    test("throws for malformed infix", () => {
        expect(() => rewriteInfixExpressions("{{#if score >}}x{{/if}}")).toThrow("Invalid condition \"score >\"");
    });

    test("{{set}}, {{inc}} and {{dec}}", () => {
        expect(rewriteInfixExpressions("{{set \"gold\" gold + price * 2}}{{inc \"gold\" price * 2}}{{dec \"hp\" dmg - armour}}"))
            .toBe("{{set \"gold\" (add gold (mul price 2))}}{{inc \"gold\" (mul price 2)}}{{dec \"hp\" (sub dmg armour)}}");
    });

    test("{{set}} with prefix syntax is untouched", () => {
        const text = "{{set \"score\" 100}}{{inc \"x\"}}{{set \"items\" (array \"a\")}}{{settings}}{{inc}}";
        expect(rewriteInfixExpressions(text)).toBe(text);
    });

    test("{{= expression}}", () => {
        expect(rewriteInfixExpressions("Cost: {{= price * 2}}, {{~= a + b ~}} and {{= gold}}."))
            .toBe("Cost: {{mul price 2}}, {{~add a b~}} and {{gold}}.");
    });

    test("escaped {{= }} is untouched", () => {
        expect(rewriteInfixExpressions("\\{{= a + b}}")).toBe("\\{{= a + b}}");
    });

    test("throws for malformed {{set}} and {{= }}", () => {
        expect(() => rewriteInfixExpressions("{{set \"x\" a +}}")).toThrow("Invalid expression \"\"x\" a +\"");
        expect(() => rewriteInfixExpressions("{{= a +}}")).toThrow("Invalid expression \"a +\"");
    });
});

describe("rewriteValueExpression", () => {
    test.each([
        ["gold", "gold"],
        ["10", "10"],
        ['"sword"', '"sword"'],
        ["true", "true"],
        ["gold + price * 2", "(add gold (mul price 2))"],
        ["gold > 100", "(gt gold 100)"],
        ["not has_key", "(not has_key)"],
        ['(seen "intro")', '(seen "intro")'],
    ])("%s -> %s", (input, expected) => {
        expect(rewriteValueExpression(input)).toBe(expected);
    });

    test.each(["", "gold +", "gold price", "(gold"])("rejects %j", input => {
        expect(() => rewriteValueExpression(input)).toThrow(/Invalid expression/);
    });
});

describe("splitSetters", () => {
    test.each([
        ["a = 1, b += 2", ["a = 1", "b += 2"]],
        [' message = "Hi, there", done', ['message = "Hi, there"', "done"]],
        ["name = 'Bob, the Brave', x", ["name = 'Bob, the Brave'", "x"]],
        ['a = "say \\"hi, there\\"", b', ['a = "say \\"hi, there\\""', "b"]],
        ["a = (add b 1), c", ["a = (add b 1)", "c"]],
        ["a = 1,, b = 2,", ["a = 1", "b = 2"]],
    ])("%j", (input, expected) => {
        expect(splitSetters(input)).toEqual(expected);
    });
});

describe("objects and lists (#442)", () => {
    test.each([
        ["{ hp: 10, name: \"Ann\" }", "(__object \"hp\" 10 \"name\" \"Ann\")"],
        ["{ \"max hp\": 12, 'b': 1, }", "(__object \"max hp\" 12 'b' 1)"],
        ["{}", "(__object )"],
        ["{ hp: hp + 1, inner: { a: [1] } }", "(__object \"hp\" (add hp 1) \"inner\" (__object \"a\" (array 1)))"],
        ["[1, 2, 3]", "(array 1 2 3)"],
        ["[]", "(array )"],
        ["[\"lamp\"]", "(array \"lamp\")"],
        ["[a, b]", "(array a b)"],
        ["[{ name: \"lamp\" }, { name: \"rope\" }]", "(array (__object \"name\" \"lamp\") (__object \"name\" \"rope\"))"],
        ["inventory[0]", "(lookup inventory 0)"],
        ["inventory[i].name", "(lookup (lookup inventory i) \"name\")"],
        ["grid[x][y + 1]", "(lookup (lookup grid x) (add y 1))"],
        ["hero[\"max hp\"]", "(lookup hero \"max hp\")"],
        ["inventory[i].stats.hp * 2", "(mul (lookup (lookup (lookup inventory i) \"stats\") \"hp\") 2)"],
        ["hero.hp", "hero.hp"],
        ["inventory.[0].name", "inventory.[0].name"],
        ["[my attribute]", "[my attribute]"],
        ["[a]", "[a]"],
    ])("value: %s", (input, expected) => {
        expect(rewriteValueExpression(input)).toBe(expected);
    });

    test("conditions", () => {
        expect(rewriteInfixCondition("inventory[i].hp > 5")).toBe("(gt (lookup (lookup inventory i) \"hp\") 5)");
        expect(rewriteInfixCondition("hero.hp > 5")).toBe("(gt hero.hp 5)");
        expect(rewriteInfixCondition("hero[key]")).toBe("(lookup hero key)");
    });

    test("an object in a tag", () => {
        expect(rewriteInfixExpressions("{{set \"hero\" { hp: 10, stats: { str: 2 } }}}!"))
            .toBe("{{set \"hero\" (__object \"hp\" 10 \"stats\" (__object \"str\" 2))}}!");
        expect(rewriteInfixExpressions("{{= inventory[i].name}}")).toBe("{{lookup (lookup inventory i) \"name\"}}");
    });

    test.each([
        ["{ hp 10 }", "expected ':'"],
        ["{ hp: 10", "expected '}'"],
        ["[1, 2", "expected ']'"],
        ["{ (a): 3 }", "expected a name in the object"],
        ["inventory[0", "expected ']'"],
    ])("errors: %s", (input, message) => {
        expect(() => rewriteValueExpression(input)).toThrow(message);
    });

    test("setters are split outside objects and lists", () => {
        expect(splitSetters("hero = { hp: 10, name: \"Ann\" }, list = [1, 2], gold = 0"))
            .toEqual(["hero = { hp: 10, name: \"Ann\" }", "list = [1, 2]", "gold = 0"]);
    });
});

describe("contains and ? : (#446)", () => {
    test.each([
        ["bag contains \"key\"", "(__contains bag \"key\")"],
        ["name contains \"o\" and hp > 0", "(and (__contains name \"o\") (gt hp 0))"],
        ["not bag contains \"key\"", "(not (__contains bag \"key\"))"],
        ["[1, 2] contains x + 1", "(__contains (array 1 2) (add x 1))"],
        ["hp > 0 ? \"alive\" : \"dead\"", "(cond (gt hp 0) \"alive\" \"dead\")"],
        ["a ? 1 : b ? 2 : 3", "(cond a 1 (cond b 2 3))"],
        ["a ? b ? 1 : 2 : 3", "(cond a (cond b 1 2) 3)"],
        ["x or y ? 1 : 2", "(cond (or x y) 1 2)"],
        ["gold + (rich ? 10 : 1)", "(add gold (cond rich 10 1))"],
        ["{ status: hp > 0 ? \"ok\" : \"hurt\", hp: hp }", "(__object \"status\" (cond (gt hp 0) \"ok\" \"hurt\") \"hp\" hp)"],
        ["[a ? 1 : 2, 3]", "(array (cond a 1 2) 3)"],
        ["list[a ? 0 : 1]", "(lookup list (cond a 0 1))"],
        ["(round (gold / 3))", "(round (div gold 3))"],
    ])("value: %s", (input, expected) => {
        expect(rewriteValueExpression(input)).toBe(expected);
    });

    test("conditions", () => {
        expect(rewriteInfixCondition("bag contains \"key\"")).toBe("(__contains bag \"key\")");
        expect(rewriteInfixCondition("(a ? b : c)")).toBe("(cond a b c)");
    });

    test("the contains helper is still a helper", () => {
        expect(rewriteInfixCondition("(contains \"bag\" \"key\")")).toBeNull();
        expect(rewriteInfixCondition("(contains \"bag\" \"key\") and x")).toBe("(and (contains \"bag\" \"key\") x)");
        expect(rewriteInfixCondition("contains")).toBeNull();
    });

    test("in tags", () => {
        expect(rewriteInfixExpressions("{{= hp > 0 ? \"alive\" : \"dead\"}}")).toBe("{{cond (gt hp 0) \"alive\" \"dead\"}}");
        expect(rewriteInfixExpressions("{{set \"x\" a ? 1 : 2}}")).toBe("{{set \"x\" (cond a 1 2)}}");
        expect(rewriteInfixExpressions("{{#if name contains \"x\"}}")).toBe("{{#if (__contains name \"x\")}}");
    });

    test.each([
        ["a ?", "expected a value after '?'"],
        ["a ? 1", "expected ':'"],
        ["a ? 1 :", "expected a value after ':'"],
        ["a contains", "expected a value after 'contains'"],
    ])("errors: %s", (input, message) => {
        expect(() => rewriteValueExpression(input)).toThrow(message);
    });
});

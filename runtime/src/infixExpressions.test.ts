import { expect, test, describe } from "vitest";
import { rewriteInfixCondition, rewriteInfixExpressions } from "./infixExpressions.js";

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

    test("error message includes the condition", () => {
        expect(() => rewriteInfixCondition(" score > ")).toThrow("Invalid condition \"score >\": expected a value after '>'");
    });

    test("malformed prefix syntax is left for Handlebars to report", () => {
        expect(rewriteInfixCondition("a b")).toBeNull();
        expect(rewriteInfixCondition("(eq a")).toBeNull();
        expect(rewriteInfixCondition("\"unterminated")).toBeNull();
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
});

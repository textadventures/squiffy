import { expect, test } from "vitest";
import { captureEveryBodies } from "./every.js";

const body = (text: string) => `__body="${encodeURIComponent(text)}"`;

test("captureEveryBodies copies each {{#every}}'s text into it (#451)", () => {
    expect(captureEveryBodies("A {{#every 1000}}Tick {{n}}{{/every}} B"))
        .toBe(`A {{#every 1000 ${body("Tick {{n}}")}}}Tick {{n}}{{/every}} B`);
    expect(captureEveryBodies("{{~#every 1000 times=2~}}x{{~/every~}}"))
        .toBe(`{{~#every 1000 times=2 ${body("x")}~}}x{{~/every~}}`);
    expect(captureEveryBodies("{{#every \"1s\"}}\"quoted}}\"{{/every}}"))
        .toBe(`{{#every "1s" ${body("\"quoted}}\"")}}}"quoted}}"{{/every}}`);
});

test("captureEveryBodies handles {{#every}} inside {{#every}}", () => {
    const inner = "{{#every 500}}in{{/every}}";
    expect(captureEveryBodies(`{{#every 1000}}out ${inner}{{/every}}`))
        .toBe(`{{#every 1000 ${body(`out ${inner}`)}}}out {{#every 500 ${body("in")}}}in{{/every}}{{/every}}`);
});

test("captureEveryBodies leaves other text alone", () => {
    for (const text of ["no tags", "{{#if a}}x{{/if}}", "\\{{#every 1000}}x{{/every}}", "{{#everything}}x{{/everything}}"]) {
        expect(captureEveryBodies(text)).toBe(text);
    }
});

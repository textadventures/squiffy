import { describe, expect, test } from "vitest";
import type { CodeAction, Diagnostic } from "squiffy-compiler/language-service";
import { collectProblems, countProblems } from "./problems.js";

const at = (line: number, character = 0) => ({ start: { line, character }, end: { line, character: character + 1 } });

function diagnostic(file: string, line: number, severity: Diagnostic["severity"], code: Diagnostic["code"] = "squiffy/dead-end"): Diagnostic {
    return { file, range: at(line), severity, code, message: `${code} at ${line}` };
}

const fix = (title: string, d?: Diagnostic): CodeAction => ({ title, kind: "quickfix", diagnostic: d, edit: {} });

describe("collectProblems", () => {
    test("sorts by severity, then the main file first, then file and line", () => {
        const problems = collectProblems([
            { file: "b.squiffy", diagnostics: [diagnostic("b.squiffy", 3, "warning"), diagnostic("b.squiffy", 1, "error")], actions: [] },
            { file: "a.squiffy", diagnostics: [diagnostic("a.squiffy", 5, "hint"), diagnostic("a.squiffy", 2, "warning")], actions: [] },
            { file: "main.squiffy", diagnostics: [diagnostic("main.squiffy", 9, "warning")], actions: [] },
        ], "main.squiffy");
        expect(problems.map(p => `${p.diagnostic.severity} ${p.diagnostic.file}:${p.diagnostic.range.start.line}`)).toEqual([
            "error b.squiffy:1",
            "warning main.squiffy:9",
            "warning a.squiffy:2",
            "warning b.squiffy:3",
            "hint a.squiffy:5",
        ]);
    });

    test("puts each fix on the diagnostic it fixes", () => {
        const first = diagnostic("s.squiffy", 1, "warning");
        const second = diagnostic("s.squiffy", 4, "warning");
        const [a, b] = collectProblems([
            { file: "s.squiffy", diagnostics: [first, second], actions: [fix("Mark as an ending", second)] },
        ]);
        expect(a.fixes).toEqual([]);
        expect(b.fixes.map(f => f.title)).toEqual(["Mark as an ending"]);
    });

    test("offers a file-wide Squiffy 5 conversion on each Squiffy 5 problem", () => {
        const v5 = diagnostic("s.squiffy", 2, "warning", "squiffy/v5-syntax");
        const other = diagnostic("s.squiffy", 3, "warning");
        const [first, second] = collectProblems([
            { file: "s.squiffy", diagnostics: [v5, other], actions: [fix("Convert this", v5), fix("Convert all")] },
        ]);
        expect(first.fixes.map(f => f.title)).toEqual(["Convert this", "Convert all"]);
        expect(second.fixes).toEqual([]);
    });
});

test("countProblems counts each severity", () => {
    const problems = collectProblems([
        { file: "s.squiffy", diagnostics: [diagnostic("s.squiffy", 1, "error"), diagnostic("s.squiffy", 2, "warning"), diagnostic("s.squiffy", 3, "warning")], actions: [] },
    ]);
    expect(countProblems(problems)).toEqual({ error: 1, warning: 2, hint: 0 });
});

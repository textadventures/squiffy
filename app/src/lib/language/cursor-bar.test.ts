import { describe, expect, test } from "vitest";
import type { Action, Diagnostic } from "@codemirror/lint";
import { fixAt } from "./cursor-bar.js";

const action = (name: string): Action => ({ name, apply: () => {} });

function at(from: number, to: number, severity: Diagnostic["severity"], ...actions: Action[]) {
    return { from, to, diagnostic: { from, to, severity, message: "", actions } };
}

describe("the fix at the cursor", () => {
    const ignore = action("Ignore this warning in this section");
    const create = action("Create section 'cellar'");
    const isPreferred = (a: Action) => a !== ignore;

    test("is the preferred fix of a problem the cursor's in, at either end too", () => {
        const problems = [at(10, 20, "warning", ignore, create)];
        expect(fixAt(problems, 10, isPreferred)?.action).toBe(create);
        expect(fixAt(problems, 20, isPreferred)).toEqual({ action: create, from: 10, to: 20 });
        expect(fixAt(problems, 21, isPreferred)).toBeUndefined();
    });

    test("is never one that isn't preferred, such as Ignore", () => {
        expect(fixAt([at(0, 5, "warning", ignore)], 2, isPreferred)).toBeUndefined();
        expect(fixAt([at(0, 5, "warning")], 2, isPreferred)).toBeUndefined();
    });

    test("is for the most serious problem there, then the narrowest", () => {
        const end = action("Mark this section as an ending");
        const change = action("Change to price");
        const convert = action("Convert to {{price}}");
        expect(fixAt([at(0, 30, "warning", end), at(5, 10, "warning", change)], 7, isPreferred)?.action).toBe(change);
        expect(fixAt([at(5, 10, "warning", change), at(0, 30, "error", convert)], 7, isPreferred)?.action).toBe(convert);
    });
});

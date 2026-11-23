import { describe, expect, it } from "vitest";
import { describeError } from "./errors.js";

describe("describeError", () => {
    it("keeps an Error's message and stack", () => {
        const error = new TypeError("Cannot read properties of undefined (reading 'name')");
        const described = describeError(error);
        expect(described.message).toBe("Cannot read properties of undefined (reading 'name')");
        expect(described.detail).toContain("TypeError");
    });

    it("falls back to the name when an Error has no message", () => {
        const error = new RangeError();
        error.stack = undefined;
        expect(describeError(error)).toEqual({ message: "RangeError", detail: undefined });
    });

    it("shows a thrown string as it is", () => {
        expect(describeError("oops")).toEqual({ message: "oops" });
    });

    it("shows other thrown values as JSON", () => {
        expect(describeError({ code: 42 })).toEqual({ message: '{"code":42}' });
        expect(describeError(undefined)).toEqual({ message: "undefined" });
    });

    it("copes with values that can't be turned into JSON", () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(describeError(circular)).toEqual({ message: "[object Object]" });
    });
});

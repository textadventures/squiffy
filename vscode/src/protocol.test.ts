import { describe, expect, test } from "vitest";
import { fromBase64, toBase64 } from "./protocol.js";

describe("base64", () => {
    test("round-trips bytes, including a file bigger than one chunk", () => {
        const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
        const text = toBase64(bytes);
        expect(text).toBe(Buffer.from(bytes).toString("base64"));
        expect(fromBase64(text)).toEqual(bytes);
    });

    test("an empty file", () => {
        expect(toBase64(new Uint8Array())).toBe("");
        expect(fromBase64("")).toEqual(new Uint8Array());
    });
});

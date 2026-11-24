import { expect, test } from "vitest";
import { unzipSizeLimit, ZipTooBigError } from "./zip-limits.js";

test("files can come to the limit, and no more", () => {
    const filter = unzipSizeLimit(100);
    expect(filter({ originalSize: 60 })).toBe(true);
    expect(filter({ originalSize: 40 })).toBe(true);
    expect(() => filter({ originalSize: 1 })).toThrow(ZipTooBigError);
});

test("one file that says it's too big", () => {
    expect(() => unzipSizeLimit(100)({ originalSize: 2 ** 32 })).toThrow(ZipTooBigError);
});

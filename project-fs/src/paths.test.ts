import { expect, test } from "vitest";
import { basename, dirname, extname, normalizePath, parsePath, resolvePath } from "./paths.js";

test("parsePath", () => {
    expect(parsePath("a/b.txt")).toEqual(["a", "b.txt"]);
    expect(parsePath("./a/")).toEqual(["a"]);
    expect(parsePath("", true)).toEqual([]);
    expect(parsePath(".", true)).toEqual([]);
    expect(() => parsePath("")).toThrow();
    expect(parsePath(".gitignore")).toEqual([".gitignore"]);
    expect(parsePath("con-fig.txt")).toEqual(["con-fig.txt"]);
    expect(() => parsePath("COM1.txt")).toThrow();
    expect(() => parsePath(42 as unknown as string)).toThrow();
});

test("normalizePath gives NFC", () => {
    expect(normalizePath("./café.txt")).toBe("café.txt");
});

test("dirname, basename, extname", () => {
    expect(dirname("a/b/c.txt")).toBe("a/b");
    expect(dirname("c.txt")).toBe("");
    expect(basename("a/b/c.txt")).toBe("c.txt");
    expect(extname("a/b.c/d.SQUIFFY")).toBe(".SQUIFFY");
    expect(extname(".gitignore")).toBe("");
});

test("resolvePath", () => {
    expect(resolvePath("", "a/b.js")).toBe("a/b.js");
    expect(resolvePath("story", "../lib/x.js")).toBe("lib/x.js");
    expect(resolvePath("story", "./x.js")).toBe("story/x.js");
    expect(resolvePath("", "../x.js")).toBeNull();
});

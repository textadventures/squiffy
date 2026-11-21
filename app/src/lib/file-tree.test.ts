import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { foldersOf, isBuildPath, loadFolderState, saveFolderState, treeRows } from "./file-tree.js";

const files = ["a.squiffy", "build/index.html", "build/story.js", "images/big/x.png", "images/y.png", "squiffy.json"];

describe("treeRows", () => {
    it("starts with the build folder closed and the others open", () => {
        expect(treeRows(files, {})).toEqual([
            { kind: "file", path: "a.squiffy", depth: 0 },
            { kind: "folder", path: "build", depth: 0, open: false },
            { kind: "folder", path: "images", depth: 0, open: true },
            { kind: "folder", path: "images/big", depth: 1, open: true },
            { kind: "file", path: "images/big/x.png", depth: 2 },
            { kind: "file", path: "images/y.png", depth: 1 },
            { kind: "file", path: "squiffy.json", depth: 0 },
        ]);
    });

    it("hides everything inside a closed folder, folders included", () => {
        const rows = treeRows(files, { images: false, build: true });
        expect(rows.map(r => r.path)).toEqual(["a.squiffy", "build", "build/index.html", "build/story.js", "images", "squiffy.json"]);
    });

    it("keeps a closed folder's own state when its parent is closed", () => {
        const rows = treeRows(files, { images: false, "images/big": false });
        expect(rows.find(r => r.path == "images")).toEqual({ kind: "folder", path: "images", depth: 0, open: false });
        expect(treeRows(files, { "images/big": false }).find(r => r.path == "images/big")).toMatchObject({ open: false });
    });

    it("only treats the top-level build folder as the build", () => {
        expect(treeRows(["chapters/build/a.squiffy"], {}).map(r => r.path)).toEqual(["chapters", "chapters/build", "chapters/build/a.squiffy"]);
        expect(isBuildPath("build/x.js")).toBe(true);
        expect(isBuildPath("builder.squiffy")).toBe(false);
        expect(isBuildPath("chapters/build/x.js")).toBe(false);
    });
});

describe("foldersOf", () => {
    it("lists a file's folders, outermost first", () => {
        expect(foldersOf("a/b/c.squiffy")).toEqual(["a", "a/b"]);
        expect(foldersOf("c.squiffy")).toEqual([]);
        expect(foldersOf("")).toEqual([]);
    });
});

describe("folder state", () => {
    const source = { kind: "folder" as const, id: "abc" };
    const store = new Map<string, string>();
    beforeEach(() => {
        store.clear();
        globalThis.localStorage = {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
            removeItem: (k: string) => void store.delete(k),
        } as Storage;
    });
    afterEach(() => {
        delete (globalThis as { localStorage?: Storage }).localStorage;
    });

    it("keeps only what differs from the default, for each project", () => {
        saveFolderState(source, { build: true, images: false, chapters: true });
        expect(loadFolderState(source)).toEqual({ build: true, images: false });
        expect(loadFolderState({ kind: "browser", id: "abc" })).toEqual({});
        saveFolderState(source, { build: false });
        expect(store.size).toBe(0);
    });

    it("ignores anything unreadable", () => {
        store.set("squiffy-editor-folders:folder:abc", "not json");
        expect(loadFolderState(source)).toEqual({});
        store.set("squiffy-editor-folders:folder:abc", JSON.stringify({ build: "yes", images: false }));
        expect(loadFolderState(source)).toEqual({ images: false });
    });
});

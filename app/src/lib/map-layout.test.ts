import { beforeEach, expect, test } from "vitest";
import { openNextStoryOnMap, readMapLayout, saveMapLayout } from "./map-layout.js";

beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
    } as Storage;
});

test("remembers how each story's map was left", () => {
    expect(readMapLayout("a")).toBeUndefined();
    saveMapLayout("a", { open: true, maximized: true });
    saveMapLayout("b", { open: false, maximized: false });
    expect(readMapLayout("a")).toEqual({ open: true, maximized: true });
    expect(readMapLayout("b")).toEqual({ open: false, maximized: false });
});

test("forgets the stories opened longest ago", () => {
    for (let i = 0; i < 101; i++) saveMapLayout(`story${i}`, { open: true, maximized: false });
    saveMapLayout("story1", { open: true, maximized: true });
    saveMapLayout("another", { open: true, maximized: false });
    expect(readMapLayout("story0")).toBeUndefined();
    expect(readMapLayout("story2")).toBeUndefined();
    expect(readMapLayout("story1")).toEqual({ open: true, maximized: true });
});

test("a story converted from Twine opens on the full-screen map, once", () => {
    openNextStoryOnMap();
    expect(readMapLayout("new")).toEqual({ open: true, maximized: true });
    expect(readMapLayout("new")).toBeUndefined();
});

test("anything else in storage is ignored", () => {
    localStorage.setItem("squiffy-map-layout", "[1]");
    expect(readMapLayout("a")).toBeUndefined();
    localStorage.setItem("squiffy-map-layout", "not json");
    expect(readMapLayout("a")).toBeUndefined();
});

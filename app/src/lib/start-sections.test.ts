import { describe, expect, test } from "vitest";
import type { StoryGraph } from "squiffy-compiler/language-service";
import { findSections, startSections } from "./start-sections.js";

const node = (name: string, more: object = {}) => ({ id: `section:${name}`, kind: "section", name, ...more });
const graph = {
    nodes: [
        node(""), node("_default", { detail: "(Start)" }), node("hall"), node("_continue1", { detail: "+++Continue..." }),
        node("the vault"), node("shortcuts", { test: "marked" }), node("vault with key", { test: "reached" }),
        { id: "passage:hall/look", kind: "passage", name: "look", section: "hall" },
    ],
    edges: [],
    reachabilityKnown: true,
} as unknown as StoryGraph;

describe("the preview's Start at menu", () => {
    test("lists the sections with names, those marked @test first", () => {
        expect(startSections(graph)).toEqual([
            { name: "shortcuts", test: true },
            { name: "hall", test: false },
            { name: "the vault", test: false },
            { name: "vault with key", test: false },
        ]);
    });

    test("finds sections by part of their name, whatever its case", () => {
        const sections = startSections(graph);
        expect(findSections(sections, " VAULT ").map(s => s.name)).toEqual(["the vault", "vault with key"]);
        expect(findSections(sections, "")).toEqual(sections);
        expect(findSections(sections, "nowhere")).toEqual([]);
    });
});

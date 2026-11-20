import { describe, expect, it } from "vitest";
import { MemoryFileSystem, MemoryStore } from "@textadventures/project-fs";
import { OpenProject } from "./project.svelte.js";

async function withTabs(...paths: string[]) {
    const fs = new MemoryFileSystem("story", new MemoryStore());
    for (const path of paths) await fs.write(path, path);
    const project = new OpenProject(fs, { kind: "browser", id: "test" }, paths[0]);
    await project.refreshFiles();
    for (const path of paths) await project.open(path);
    const order = () => project.openFiles.map(f => f.path);
    return { project, order };
}

describe("moveTab", () => {
    it("moves a tab before another", async () => {
        const { project, order } = await withTabs("a.squiffy", "b.squiffy", "c.squiffy");
        project.moveTab("c.squiffy", 0);
        expect(order()).toEqual(["c.squiffy", "a.squiffy", "b.squiffy"]);
    });

    it("counts the index from before the tab is moved", async () => {
        const { project, order } = await withTabs("a.squiffy", "b.squiffy", "c.squiffy");
        project.moveTab("a.squiffy", 2);
        expect(order()).toEqual(["b.squiffy", "a.squiffy", "c.squiffy"]);
        project.moveTab("b.squiffy", 3);
        expect(order()).toEqual(["a.squiffy", "c.squiffy", "b.squiffy"]);
    });

    it("leaves the order alone when a tab is dropped where it is, or out of range", async () => {
        const { project, order } = await withTabs("a.squiffy", "b.squiffy", "c.squiffy");
        project.moveTab("b.squiffy", 1);
        project.moveTab("b.squiffy", 2);
        expect(order()).toEqual(["a.squiffy", "b.squiffy", "c.squiffy"]);
        project.moveTab("a.squiffy", -1);
        project.moveTab("missing.squiffy", 0);
        expect(order()).toEqual(["a.squiffy", "b.squiffy", "c.squiffy"]);
        project.moveTab("a.squiffy", 99);
        expect(order()).toEqual(["b.squiffy", "c.squiffy", "a.squiffy"]);
    });
});

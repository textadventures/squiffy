import { describe, expect, it, vi } from "vitest";
import { MemoryFileSystem, MemoryStore } from "@textadventures/project-fs";
import { changedPaths, reconcile } from "./disk-changes.js";
import { OpenProject } from "./project.svelte.js";

describe("reconcile", () => {
    it("does nothing when the disk has the last known version", () => {
        expect(reconcile("mine", "saved", "saved")).toEqual({ kind: "none" });
    });

    it("reloads a file with no unsaved changes", () => {
        expect(reconcile("saved", "saved", "theirs")).toEqual({ kind: "reload", text: "theirs" });
    });

    it("counts unsaved changes as saved when the disk has the same text", () => {
        expect(reconcile("mine", "saved", "mine")).toEqual({ kind: "saved", text: "mine" });
    });

    it("is a conflict when there are unsaved changes and the disk has something else", () => {
        expect(reconcile("mine", "saved", "theirs")).toEqual({ kind: "conflict", text: "theirs" });
    });

    it("notices a deleted file", () => {
        expect(reconcile("saved", "saved", null)).toEqual({ kind: "deleted" });
    });
});

describe("changedPaths", () => {
    it("lists files added, removed and modified", () => {
        const before = [{ path: "a", lastModified: 1 }, { path: "b", lastModified: 1 }, { path: "c", lastModified: 1 }];
        const after = [{ path: "a", lastModified: 1 }, { path: "b", lastModified: 2 }, { path: "d", lastModified: 1 }];
        expect(changedPaths(before, after).sort()).toEqual(["b", "c", "d"]);
    });
});

// The editor's view of a project, and another program's view of the same files
async function setUp(files: Record<string, string>) {
    const store = new MemoryStore();
    const fs = new MemoryFileSystem("story", store);
    const other = new MemoryFileSystem("story", store);
    for (const [path, text] of Object.entries(files)) await other.write(path, text);
    const project = new OpenProject(fs, { kind: "browser", id: "test" }, "story.squiffy");
    await project.refreshFiles();
    const changed: string[] = [];
    project.onFileChanged = path => changed.push(path);
    project.watch();
    // Watch events come in a microtask, and are handled in a queue
    const settle = async () => {
        await new Promise(r => setTimeout(r, 0));
        await project.checkDisk();
        changed.length = 0;
    };
    return { project, other, changed, settle };
}

describe("OpenProject, with changes made outside the editor", () => {
    it("reloads an open file with no unsaved changes", async () => {
        const { project, other, settle } = await setUp({ "story.squiffy": "one" });
        await project.open("story.squiffy");
        await other.write("story.squiffy", "two");
        await settle();
        const file = project.fileAt("story.squiffy")!;
        expect(file.text).toBe("two");
        expect(file.dirty).toBe(false);
        expect(file.held).toBe(false);
    });

    it("holds an open file with unsaved changes, and doesn't save over the other program's", async () => {
        const { project, other, settle } = await setUp({ "story.squiffy": "one" });
        await project.open("story.squiffy");
        const file = project.fileAt("story.squiffy")!;
        file.setText("mine");
        await other.write("story.squiffy", "theirs");
        await settle();
        expect(file.conflict).toBe("theirs");
        await project.save();
        expect(await other.readText("story.squiffy")).toBe("theirs");
        expect(file.text).toBe("mine");
    });

    it("writes the editor's text after Keep my changes", async () => {
        const { project, other, settle } = await setUp({ "story.squiffy": "one" });
        await project.open("story.squiffy");
        const file = project.fileAt("story.squiffy")!;
        file.setText("mine");
        await other.write("story.squiffy", "theirs");
        await settle();
        await file.keepMine();
        expect(await other.readText("story.squiffy")).toBe("mine");
        expect(file.held).toBe(false);
        expect(file.dirty).toBe(false);
    });

    it("shows the other program's text after Use the changed file", async () => {
        const { project, other, settle } = await setUp({ "story.squiffy": "one" });
        await project.open("story.squiffy");
        const file = project.fileAt("story.squiffy")!;
        file.setText("mine");
        await other.write("story.squiffy", "theirs");
        await settle();
        file.reload();
        expect(file.text).toBe("theirs");
        expect(file.dirty).toBe(false);
        expect(file.held).toBe(false);
    });

    it("doesn't save over a change it wasn't told about", async () => {
        const { project, other } = await setUp({ "story.squiffy": "one" });
        await project.open("story.squiffy");
        project.closeAll(); // stops watching
        const file = project.fileAt("story.squiffy")!;
        file.setText("mine");
        await other.write("story.squiffy", "theirs");
        await file.save();
        expect(await other.readText("story.squiffy")).toBe("theirs");
        expect(file.conflict).toBe("theirs");
    });

    it("doesn't put back a deleted file", async () => {
        const { project, other, settle } = await setUp({ "story.squiffy": "one", "other.squiffy": "x" });
        await project.open("other.squiffy");
        const file = project.fileAt("other.squiffy")!;
        file.setText("mine");
        await other.delete("other.squiffy");
        await settle();
        expect(file.deleted).toBe(true);
        await project.save();
        expect(await other.exists("other.squiffy")).toBe(false);
        expect(project.files.map(f => f.path)).toEqual(["story.squiffy"]);
        await file.keepMine();
        expect(await other.readText("other.squiffy")).toBe("mine");
        expect(file.deleted).toBe(false);
        expect(project.files.map(f => f.path).sort()).toEqual(["other.squiffy", "story.squiffy"]);
    });

    it("updates the file list and tells the language service about new files", async () => {
        const { project, other, changed } = await setUp({ "story.squiffy": "one" });
        const told = vi.fn();
        project.onFileChanged = told;
        await other.write("new.squiffy", "hello");
        await new Promise(r => setTimeout(r, 0));
        await project.checkDisk();
        expect(project.files.map(f => f.path).sort()).toEqual(["new.squiffy", "story.squiffy"]);
        expect(told).toHaveBeenCalledWith("new.squiffy");
        expect(changed).toEqual([]);
    });

    it("finds changes on focus when the file system can't be watched", async () => {
        const { project, other } = await setUp({ "story.squiffy": "one" });
        await project.open("story.squiffy");
        project.closeAll();
        await other.write("story.squiffy", "two");
        await project.checkDisk();
        expect(project.fileAt("story.squiffy")!.text).toBe("two");
    });
});

import { expect, test } from "vitest";
import { MemoryFileSystem } from "./memory.js";
import { copyProject, findFiles, moveFile } from "./util.js";

test("findFiles filters by extension", async () => {
    const fs = await MemoryFileSystem.from({ "a.squiffy": "", "b/c.SQUIFFY": "", "d.js": "" });
    const found = await findFiles(fs, [{ description: "Squiffy", extensions: [".squiffy"] }]);
    expect(found.map((f) => f.path)).toEqual(["a.squiffy", "b/c.SQUIFFY"]);
});

test("copyProject copies everything, and won't overwrite by default", async () => {
    const from = await MemoryFileSystem.from({ "a.squiffy": "a", "img/b.png": new Uint8Array([1]) });
    const to = new MemoryFileSystem();
    await copyProject(from, to);
    expect(await to.list()).toEqual(await from.list().then((l) => l.map((f) => ({ ...f, lastModified: expect.any(Number) }))));
    await expect(copyProject(from, to)).rejects.toThrow(/isn't empty/);
    await copyProject(from, to, { overwrite: true });
});

test("moveFile renames, including case-only renames", async () => {
    const fs = await MemoryFileSystem.from({ "a.txt": "a", "b.txt": "b" });
    await moveFile(fs, "a.txt", "dir/c.txt");
    expect((await fs.list()).map((f) => f.path)).toEqual(["b.txt", "dir/c.txt"]);
    await expect(moveFile(fs, "b.txt", "dir/c.txt")).rejects.toThrow(/already exists/);
    await moveFile(fs, "b.txt", "B.txt");
    expect((await fs.list()).map((f) => f.path)).toEqual(["B.txt", "dir/c.txt"]);
    expect(await fs.readText("B.txt")).toBe("b");
});

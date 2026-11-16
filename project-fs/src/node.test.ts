import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { isProjectFsError } from "./errors.js";
import { NodeFileSystem } from "./node.js";
import { runConformance } from "./test/conformance.js";

runConformance("NodeFileSystem", async () => {
    const dir = await mkdtemp(join(tmpdir(), "project-fs-"));
    const fs = new NodeFileSystem(dir);
    const other = new NodeFileSystem(dir);
    return {
        fs,
        external: { write: (p, d) => other.write(p, d), delete: (p) => other.delete(p) },
        cleanup: async () => {
            fs.close();
            await rm(dir, { recursive: true, force: true });
        },
    };
});

// Paths that must never be reachable: everything in `outside` sits next to the project root.
describe("NodeFileSystem keeps every path inside the root", () => {
    let base: string;
    let root: string;
    let outside: string;
    let fs: NodeFileSystem;

    beforeEach(async () => {
        base = await mkdtemp(join(tmpdir(), "project-fs-sec-"));
        root = join(base, "project");
        outside = join(base, "outside");
        await mkdir(root);
        await mkdir(outside);
        await writeFile(join(outside, "secret.txt"), "secret");
        fs = new NodeFileSystem(root);
    });
    afterEach(async () => {
        fs.close();
        await rm(base, { recursive: true, force: true });
    });

    const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (isProjectFsError(e) ? e.code : String(e)));

    test("traversal and absolute paths", async () => {
        for (const p of ["../outside/secret.txt", "a/../../outside/secret.txt", join(outside, "secret.txt"), "..\\outside\\secret.txt"]) {
            expect(await code(fs.read(p))).toBe("INVALID_PATH");
            expect(await code(fs.write(p, "x"))).toBe("INVALID_PATH");
            expect(await code(fs.delete(p))).toBe("INVALID_PATH");
        }
        expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("secret");
    });

    test("a symlinked directory pointing outside can't be read, listed or written through", async () => {
        await symlink(outside, join(root, "link"), "dir");
        expect(await fs.list()).toEqual([]);
        expect(await code(fs.read("link/secret.txt"))).toBe("NOT_FOUND");
        expect(await fs.exists("link/secret.txt")).toBe(false);
        expect(await code(fs.write("link/new.txt", "x"))).toBe("OUTSIDE_ROOT");
        expect(await code(fs.write("link/secret.txt", "x"))).toBe("OUTSIDE_ROOT");
        expect(await code(fs.delete("link/secret.txt"))).toBe("NOT_FOUND");
        expect(await readdir(outside)).toEqual(["secret.txt"]);
        expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("secret");
    });

    test("a symlinked file pointing outside is invisible and can't be overwritten", async () => {
        await symlink(join(outside, "secret.txt"), join(root, "leak.txt"));
        expect(await fs.list()).toEqual([]);
        expect(await code(fs.read("leak.txt"))).toBe("NOT_FOUND");
        expect(await code(fs.write("leak.txt", "pwned"))).toBe("OUTSIDE_ROOT");
        expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("secret");
    });

    test("a dangling symlink can't be used to create a file outside", async () => {
        await symlink(join(outside, "created.txt"), join(root, "dangle.txt"));
        await symlink(join(outside, "newdir"), join(root, "dangledir"));
        expect(await code(fs.write("dangle.txt", "x"))).toBe("OUTSIDE_ROOT");
        expect(await code(fs.write("dangledir/x.txt", "x"))).toBe("OUTSIDE_ROOT");
        expect(await readdir(outside)).toEqual(["secret.txt"]);
    });

    test("a symlink to a file inside the root works; symlinked directories are not followed", async () => {
        await writeFile(join(root, "real.txt"), "real");
        await symlink(join(root, "real.txt"), join(root, "alias.txt"));
        await mkdir(join(root, "sub"));
        await writeFile(join(root, "sub", "a.txt"), "a");
        await symlink(join(root, "sub"), join(root, "loop"), "dir");
        expect((await fs.list()).map((f) => f.path)).toEqual(["alias.txt", "real.txt", "sub/a.txt"]);
        expect(await fs.readText("alias.txt")).toBe("real");
        expect(await code(fs.read("loop/a.txt"))).toBe("NOT_FOUND");
    });

    test("the root itself may be reached through a symlink", async () => {
        await symlink(root, join(base, "root-link"), "dir");
        const viaLink = new NodeFileSystem(join(base, "root-link"));
        await viaLink.write("a.txt", "a");
        expect(await readFile(join(root, "a.txt"), "utf8")).toBe("a");
    });

    test("the root must be absolute", () => {
        expect(() => new NodeFileSystem("relative/dir")).toThrow(/absolute/);
    });
});

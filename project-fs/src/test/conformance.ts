import { resolveObjectURL } from "node:buffer";
import { afterEach, describe, expect, test } from "vitest";
import { isProjectFsError, type ProjectFsErrorCode } from "../errors.js";
import type { FileChange, ProjectFileSystem } from "../types.js";

// The behaviour every ProjectFileSystem adapter must share. Each adapter's test file calls
// runConformance() with a factory for a fresh, empty project.

export interface ConformanceTarget {
    fs: ProjectFileSystem;
    /**
     * Writes that bypass `fs` (another program, another instance), for testing watch(). Leave
     * out if the adapter has no watch().
     */
    external?: {
        write(path: string, data: string): Promise<void>;
        delete(path: string): Promise<void>;
    };
    cleanup?(): Promise<void>;
}

const enc = (s: string) => new TextEncoder().encode(s);

async function expectCode(promise: Promise<unknown>, code: ProjectFsErrorCode) {
    let error: unknown;
    try {
        await promise;
    } catch (err) {
        error = err;
    }
    expect(error, `expected ${code}`).toBeDefined();
    if (!isProjectFsError(error, code)) {
        throw new Error(`expected ProjectFsError ${code}, got ${String(error)} (code ${(error as { code?: string })?.code})`);
    }
}

async function waitFor<T>(check: () => T | undefined, timeoutMs = 5000): Promise<T> {
    const start = Date.now();
    for (;;) {
        const value = check();
        if (value !== undefined) return value;
        if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
        await new Promise((r) => setTimeout(r, 20));
    }
}

export const INVALID_PATHS = [
    "",
    "/abs.txt",
    "../up.txt",
    "a/../../up.txt",
    "a/../b.txt",
    "a//b.txt",
    "C:/x.txt",
    "c:x.txt",
    "a\\b.txt",
    "..\\up.txt",
    "nul\u0000.txt",
    "a:stream",
    "con",
    "aux.txt",
    "trailing.",
    "trailing ",
    "q?.txt",
];

export function runConformance(name: string, create: () => Promise<ConformanceTarget>) {
    describe(`${name}: ProjectFileSystem conformance`, () => {
        let target: ConformanceTarget;
        let fs: ProjectFileSystem;

        const setup = async () => {
            target = await create();
            fs = target.fs;
        };
        afterEach(async () => {
            await target?.cleanup?.();
        });

        test("a new project is empty", async () => {
            await setup();
            expect(await fs.list()).toEqual([]);
            expect(typeof fs.name).toBe("string");
        });

        test("round-trips bytes and text", async () => {
            await setup();
            const bytes = new Uint8Array(256).map((_, i) => i);
            await fs.write("all-bytes.bin", bytes);
            expect(await fs.read("all-bytes.bin")).toEqual(bytes);
            await fs.write("story.squiffy", "Héllo, wörld ✨\n");
            expect(await fs.readText("story.squiffy")).toBe("Héllo, wörld ✨\n");
            expect(await fs.read("story.squiffy")).toEqual(enc("Héllo, wörld ✨\n"));
        });

        test("readText drops a UTF-8 byte-order mark", async () => {
            await setup();
            await fs.write("bom.txt", new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]));
            expect(await fs.readText("bom.txt")).toBe("hi");
        });

        test("write copies the caller's buffer", async () => {
            await setup();
            const data = enc("abc");
            await fs.write("a.txt", data);
            data[0] = 0x7a;
            expect(await fs.readText("a.txt")).toBe("abc");
            const read = await fs.read("a.txt");
            read[0] = 0x7a;
            expect(await fs.readText("a.txt")).toBe("abc");
        });

        test("write replaces an existing file, including with a shorter one", async () => {
            await setup();
            await fs.write("a.txt", "a long first version");
            await fs.write("a.txt", "short");
            expect(await fs.readText("a.txt")).toBe("short");
            await fs.write("a.txt", "");
            expect(await fs.readText("a.txt")).toBe("");
        });

        test("write creates parent directories, and list is recursive and sorted", async () => {
            await setup();
            await fs.write("z.squiffy", "z");
            await fs.write("chapters/one/b.squiffy", "b");
            await fs.write("chapters/a.squiffy", "a");
            await fs.write("assets/img/cover.png", new Uint8Array([1, 2, 3]));
            const all = await fs.list();
            expect(all.map((f) => f.path)).toEqual([
                "assets/img/cover.png",
                "chapters/a.squiffy",
                "chapters/one/b.squiffy",
                "z.squiffy",
            ]);
            expect(all[0].size).toBe(3);
            expect((await fs.list("chapters")).map((f) => f.path)).toEqual(["chapters/a.squiffy", "chapters/one/b.squiffy"]);
            expect((await fs.list("./chapters/one/")).map((f) => f.path)).toEqual(["chapters/one/b.squiffy"]);
            expect(await fs.list("missing")).toEqual([]);
            await expectCode(fs.list("z.squiffy"), "NOT_A_DIRECTORY");
        });

        test("list reports a modification time when it has one", async () => {
            await setup();
            const before = Date.now() - 5000;
            await fs.write("a.txt", "a");
            const [entry] = await fs.list();
            if (entry.lastModified !== undefined) {
                expect(entry.lastModified).toBeGreaterThan(before);
                expect(entry.lastModified).toBeLessThan(Date.now() + 5000);
            }
        });

        test("a leading ./ is accepted and dropped", async () => {
            await setup();
            await fs.write("./a/b.txt", "x");
            expect((await fs.list()).map((f) => f.path)).toEqual(["a/b.txt"]);
            expect(await fs.readText("./a/b.txt")).toBe("x");
        });

        test("exists is true for files only", async () => {
            await setup();
            await fs.write("dir/a.txt", "a");
            expect(await fs.exists("dir/a.txt")).toBe(true);
            expect(await fs.exists("dir")).toBe(false);
            expect(await fs.exists("nope.txt")).toBe(false);
            expect(await fs.exists("dir/a.txt/x")).toBe(false);
        });

        test("missing files are NOT_FOUND", async () => {
            await setup();
            await expectCode(fs.read("nope.txt"), "NOT_FOUND");
            await expectCode(fs.readText("dir/nope.txt"), "NOT_FOUND");
            await expectCode(fs.delete("nope.txt"), "NOT_FOUND");
        });

        test("delete removes the file and any directories it leaves empty", async () => {
            await setup();
            await fs.write("keep.txt", "k");
            await fs.write("Deep/er/x.txt", "x");
            await fs.write("Deep/y.txt", "y");
            await fs.delete("Deep/er/x.txt");
            expect((await fs.list()).map((f) => f.path)).toEqual(["Deep/y.txt", "keep.txt"]);
            await fs.delete("Deep/y.txt");
            expect((await fs.list()).map((f) => f.path)).toEqual(["keep.txt"]);
            // The pruned "Deep" doesn't linger to block a differently-cased directory.
            await fs.write("deep/z.txt", "z");
            expect(await fs.exists("deep/z.txt")).toBe(true);
        });

        test("directories and files can't be mistaken for each other", async () => {
            await setup();
            await fs.write("dir/a.txt", "a");
            await expectCode(fs.read("dir"), "NOT_A_FILE");
            await expectCode(fs.delete("dir"), "NOT_A_FILE");
            await expectCode(fs.write("dir", "x"), "NOT_A_FILE");
            await expectCode(fs.write("dir/a.txt/b.txt", "x"), "NOT_A_DIRECTORY");
            expect(await fs.readText("dir/a.txt")).toBe("a");
        });

        test.each(INVALID_PATHS)("rejects the invalid path %j everywhere", async (path) => {
            await setup();
            await expectCode(fs.write(path, "x"), "INVALID_PATH");
            await expectCode(fs.read(path), "INVALID_PATH");
            await expectCode(fs.readText(path), "INVALID_PATH");
            await expectCode(fs.delete(path), "INVALID_PATH");
            await expectCode(fs.exists(path), "INVALID_PATH");
            if (path !== "") await expectCode(fs.list(path), "INVALID_PATH");
            expect(await fs.list()).toEqual([]);
        });

        test("paths are case-sensitive and case-only conflicts are refused", async () => {
            await setup();
            await fs.write("Readme.txt", "r");
            await fs.write("Assets/a.png", "a");
            await expectCode(fs.read("README.txt"), "NOT_FOUND");
            expect(await fs.exists("readme.txt")).toBe(false);
            await expectCode(fs.write("README.txt", "x"), "CASE_CONFLICT");
            await expectCode(fs.write("assets/b.png", "x"), "CASE_CONFLICT");
            await expectCode(fs.delete("readme.txt"), "NOT_FOUND");
            expect(await fs.readText("Readme.txt")).toBe("r");
            expect((await fs.list()).map((f) => f.path)).toEqual(["Assets/a.png", "Readme.txt"]);
            await fs.write("Assets/b.png", "b");
            expect(await fs.list("assets")).toEqual([]);
        });

        test("paths are normalised to NFC", async () => {
            await setup();
            const nfd = "cafe\u0301/re\u0301sume\u0301.txt";
            const nfc = nfd.normalize("NFC");
            await fs.write(nfd, "x");
            expect((await fs.list()).map((f) => f.path)).toEqual([nfc]);
            expect(await fs.readText(nfc)).toBe("x");
            expect(await fs.readText(nfd)).toBe("x");
            await fs.write(nfc, "y");
            expect(await fs.list()).toHaveLength(1);
        });

        test("list hides OS junk files and skips hidden directories, which stay addressable", async () => {
            await setup();
            await fs.write(".DS_Store", "junk");
            await fs.write("img/._cover.png", "junk");
            await fs.write("img/cover.png", "png");
            await fs.write(".git/config", "git");
            await fs.write("node_modules/x/index.js", "js");
            await fs.write(".gitignore", "dist");
            expect((await fs.list()).map((f) => f.path)).toEqual([".gitignore", "img/cover.png"]);
            expect(await fs.readText(".git/config")).toBe("git");
            expect((await fs.list(".git")).map((f) => f.path)).toEqual([".git/config"]);
        });

        test("url gives a releasable URL for the file's content", async () => {
            await setup();
            if (!fs.url) return;
            await fs.write("img/cover.png", new Uint8Array([137, 80, 78, 71]));
            const u = await fs.url("img/cover.png");
            expect(u.url).toMatch(/^blob:/);
            const blob = resolveObjectURL(u.url);
            expect(blob?.type).toBe("image/png");
            expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
            u.release();
            u.release();
            expect(resolveObjectURL(u.url)).toBeUndefined();
            await expectCode(fs.url("missing.png"), "NOT_FOUND");
        });

        test("watch reports external changes, not this instance's own writes", async () => {
            await setup();
            if (!fs.watch || !target.external) return;
            await fs.write("existing.txt", "1");
            const seen: FileChange[] = [];
            const stop = fs.watch((changes) => seen.push(...changes));
            try {
                await new Promise((r) => setTimeout(r, 100)); // let a native watcher start
                await fs.write("own.txt", "mine");
                await fs.write("existing.txt", "own edit");
                await target.external.write("sub/theirs.txt", "theirs");
                await waitFor(() => seen.find((c) => c.path === "sub/theirs.txt"));
                expect(seen.find((c) => c.path === "sub/theirs.txt")?.kind).toBe("changed");
                expect(seen.filter((c) => c.path === "existing.txt")).toEqual([]);
                await target.external.delete("existing.txt");
                await waitFor(() => seen.find((c) => c.path === "existing.txt" && c.kind === "deleted"));
                expect(seen.filter((c) => c.path === "own.txt")).toEqual([]);
            } finally {
                stop();
            }
            const count = seen.length;
            await target.external.write("after.txt", "x");
            await new Promise((r) => setTimeout(r, 400));
            expect(seen.slice(count).filter((c) => c.path === "after.txt")).toEqual([]);
        });
    });
}

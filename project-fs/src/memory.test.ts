import { expect, test } from "vitest";
import { MemoryFileSystem, MemoryStore } from "./memory.js";
import { runConformance } from "./test/conformance.js";

runConformance("MemoryFileSystem", async () => {
    const store = new MemoryStore();
    const other = new MemoryFileSystem("other", store);
    return {
        fs: new MemoryFileSystem("project", store),
        external: {
            write: (p, d) => other.write(p, d),
            delete: (p) => other.delete(p),
        },
    };
});

test("MemoryFileSystem.from builds a project from a map", async () => {
    const fs = await MemoryFileSystem.from({ "a.squiffy": "a", "img/b.png": new Uint8Array([1]) }, "demo");
    expect(fs.name).toBe("demo");
    expect((await fs.list()).map((f) => f.path)).toEqual(["a.squiffy", "img/b.png"]);
});

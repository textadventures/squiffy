import { describe, expect, test } from "vitest";
import { isProjectFsError } from "./errors.js";
import { OpfsProjectStore } from "./opfs/store.js";
import { handleWriteRequest, type WriteRequest } from "./opfs/writer-core.js";
import { runConformance } from "./test/conformance.js";
import { FakeDirectoryHandle, fakeRoot } from "./test/fake-fsa.js";

/** Stands in for the Safari write worker: runs the worker's own handler against the fake root. */
class InProcessWorker extends EventTarget {
    posted = 0;
    constructor(private readonly root: FileSystemDirectoryHandle) {
        super();
    }
    postMessage(req: WriteRequest) {
        this.posted++;
        const copy = structuredClone(req);
        void handleWriteRequest(this.root, copy).then((res) =>
            this.dispatchEvent(new MessageEvent("message", { data: res })),
        );
    }
}

function store(opts: { safari?: boolean } = {}) {
    const root = fakeRoot({ noWritable: opts.safari });
    let worker: InProcessWorker | undefined;
    const s = new OpfsProjectStore<{ title: string }>({
        getRoot: async () => root,
        useWorker: opts.safari ?? false,
        createWorker: () => (worker = new InProcessWorker(root)) as unknown as Worker,
    });
    return { store: s, root, worker: () => worker };
}

runConformance("OPFS project", async () => ({ fs: await store().store.create("p1") }));
runConformance("OPFS project, Safari worker writes", async () => {
    const { store: s } = store({ safari: true });
    return { fs: await s.create("p1") };
});

describe.each([false, true])("OpfsProjectStore (worker writes: %s)", (safari) => {
    test("creates, lists, opens and deletes projects with meta", async () => {
        const { store: s, worker } = store({ safari });
        expect(await s.listProjects()).toEqual([]);
        const fs = await s.create("b-story", { title: "B" });
        await fs.write("main.squiffy", "hello");
        await s.create("a-story");
        expect(await s.listProjects()).toEqual([
            { id: "a-story", meta: null },
            { id: "b-story", meta: { title: "B" } },
        ]);
        await s.setMeta("a-story", { title: "A" });
        expect(await s.getMeta("a-story")).toEqual({ title: "A" });
        // meta.json lives beside the tree, not in it.
        expect((await (await s.open("b-story")).list()).map((f) => f.path)).toEqual(["main.squiffy"]);
        expect(await (await s.open("b-story")).readText("main.squiffy")).toBe("hello");
        expect((await s.open("b-story")).name).toBe("b-story");
        await s.delete("b-story");
        expect((await s.listProjects()).map((p) => p.id)).toEqual(["a-story"]);
        if (safari) expect(worker()!.posted).toBeGreaterThan(0);
        else expect(worker()).toBeUndefined();
    });

    test("rename moves files and meta", async () => {
        const { store: s } = store({ safari });
        const fs = await s.create("old", { title: "T" });
        await fs.write("main.squiffy", "m");
        await fs.write("img/a.png", new Uint8Array([1, 2]));
        await s.rename("old", "new");
        expect(await s.exists("old")).toBe(false);
        expect(await s.getMeta("new")).toEqual({ title: "T" });
        const moved = await s.open("new");
        expect((await moved.list()).map((f) => f.path)).toEqual(["img/a.png", "main.squiffy"]);
        expect(await moved.read("img/a.png")).toEqual(new Uint8Array([1, 2]));
        await moved.write("x.txt", "x");
        expect(await moved.readText("x.txt")).toBe("x");
    });

    test("refuses duplicate, missing and invalid ids", async () => {
        const { store: s } = store({ safari });
        await s.create("a");
        await s.create("b");
        await expect(s.create("a")).rejects.toThrow(/already exists/);
        await expect(s.rename("a", "b")).rejects.toThrow(/already exists/);
        await expect(s.open("zzz")).rejects.toSatisfy((e) => isProjectFsError(e, "NOT_FOUND"));
        await expect(s.setMeta("zzz", { title: "" })).rejects.toSatisfy((e) => isProjectFsError(e, "NOT_FOUND"));
        await expect(s.create("../escape")).rejects.toSatisfy((e) => isProjectFsError(e, "INVALID_PATH"));
        await expect(s.open("a/b")).rejects.toSatisfy((e) => isProjectFsError(e, "INVALID_PATH"));
    });

    test("keeps projects under the base directory", async () => {
        const { store: s, root } = store({ safari });
        const fs = await s.create("p");
        await fs.write("a.txt", "a");
        const r = root as unknown as FakeDirectoryHandle;
        expect([...r.children.keys()]).toEqual(["projects"]);
        const p = (r.children.get("projects") as FakeDirectoryHandle).children.get("p") as FakeDirectoryHandle;
        expect([...p.children.keys()].sort()).toEqual(["files"]);
    });
});

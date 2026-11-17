import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { registerProjectFsHandlers, type ProjectFsMain } from "./electron/main.js";
import { createProjectFsBridge, exposeProjectFs } from "./electron/preload.js";
import type { ProjectFsBridge, Reply } from "./electron/protocol.js";
import { ElectronFileSystem, electronOpener } from "./electron/renderer.js";
import { NodeFileSystem } from "./node.js";
import { runConformance } from "./test/conformance.js";
import { FakeDialog, FakeIpcMain, FakeWindow } from "./test/fake-electron.js";

// Main-process handlers, preload bridge and renderer adapter wired together through fake IPC
// against a temp directory.
function setup() {
    const ipcMain = new FakeIpcMain();
    const dialog = new FakeDialog();
    const main = registerProjectFsHandlers({ ipcMain, dialog });
    const win = new FakeWindow(ipcMain);
    const bridge = createProjectFsBridge(win.ipcRenderer);
    return { ipcMain, dialog, main, win, bridge };
}

runConformance("Electron (renderer → IPC → main → disk)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "project-fs-electron-"));
    const { dialog, main, bridge } = setup();
    dialog.queue.push(dir);
    const fs = (await electronOpener(bridge).openFolder())!;
    const other = new NodeFileSystem(dir);
    return {
        fs,
        external: { write: (p, d) => other.write(p, d), delete: (p) => other.delete(p) },
        cleanup: async () => {
            main.dispose();
            await rm(dir, { recursive: true, force: true });
        },
    };
});

describe("Electron main-process handlers", () => {
    let base: string;
    let root: string;
    let outside: string;
    let env: ReturnType<typeof setup>;
    let main: ProjectFsMain;

    beforeEach(async () => {
        base = await mkdtemp(join(tmpdir(), "project-fs-electron-sec-"));
        root = join(base, "My Story");
        outside = join(base, "outside");
        await mkdir(root);
        await mkdir(outside);
        await writeFile(join(outside, "secret.txt"), "secret");
        await writeFile(join(root, "story.squiffy"), "story");
        env = setup();
        main = env.main;
    });
    afterEach(async () => {
        main.dispose();
        await rm(base, { recursive: true, force: true });
    });

    /** Calls a channel directly, as a compromised renderer could, bypassing the bridge's checks. */
    const raw = (win: FakeWindow, name: string, ...args: unknown[]) =>
        win.ipcRenderer.invoke(`projectFs:${name}`, ...args) as Promise<Reply<unknown>>;

    async function openRoot(bridge: ProjectFsBridge = env.bridge) {
        env.dialog.queue.push(root);
        return (await bridge.pickFolder())!;
    }

    test("pickFolder approves the chosen folder; cancelling gives null", async () => {
        const info = await openRoot();
        expect(info.name).toBe("My Story");
        expect(info.rootId).toMatch(/^[0-9a-f-]{36}$/);
        expect(await env.bridge.list(info.rootId)).toEqual([expect.objectContaining({ path: "story.squiffy", size: 5 })]);
        expect(await env.bridge.pickFolder()).toBeNull();
        expect(env.dialog.calls[0].properties).toEqual(["openDirectory"]);
    });

    test("pickFile makes the file's folder the root and returns the main file", async () => {
        env.dialog.queue.push(join(root, "story.squiffy"));
        const opened = await electronOpener(env.bridge).openFile({
            filters: [{ description: "Squiffy stories", extensions: [".squiffy"] }],
        });
        expect(opened!.mainFile).toBe("story.squiffy");
        expect(await opened!.fs.readText(opened!.mainFile)).toBe("story");
        expect(env.dialog.calls[0]).toMatchObject({
            properties: ["openFile"],
            filters: [{ name: "Squiffy stories", extensions: ["squiffy"] }],
        });
    });

    test("pickNewFolder lets the user create a folder", async () => {
        const target = join(base, "copy");
        await mkdir(target);
        env.dialog.queue.push(target);
        const fs = await electronOpener(env.bridge).pickNewRoot({ title: "Save As" });
        await fs!.write("story.squiffy", "copied");
        expect(await readFile(join(target, "story.squiffy"), "utf8")).toBe("copied");
        expect(env.dialog.calls[0]).toMatchObject({ title: "Save As", properties: ["openDirectory", "createDirectory", "promptToCreate"] });
    });

    test("without a dialog, pickers report NOT_SUPPORTED", async () => {
        const ipcMain = new FakeIpcMain();
        const m = registerProjectFsHandlers({ ipcMain });
        const bridge = createProjectFsBridge(new FakeWindow(ipcMain).ipcRenderer);
        await expect(bridge.pickFolder()).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
        m.dispose();
    });

    test("an unknown or made-up root id is refused", async () => {
        await openRoot();
        expect(await raw(env.win, "read", "not-a-root", "story.squiffy")).toMatchObject({ ok: false, code: "UNKNOWN_ROOT" });
        expect(await raw(env.win, "read", root, "story.squiffy")).toMatchObject({ ok: false, code: "UNKNOWN_ROOT" });
        expect(await raw(env.win, "list", { id: "x" })).toMatchObject({ ok: false, code: "UNKNOWN_ROOT" });
    });

    test("a root id only works in the window it was granted to", async () => {
        const info = await openRoot();
        const other = new FakeWindow(env.ipcMain);
        expect(await raw(other, "read", info.rootId, "story.squiffy")).toMatchObject({ ok: false, code: "UNKNOWN_ROOT" });
        expect(await raw(other, "write", info.rootId, "x.txt", "x")).toMatchObject({ ok: false, code: "UNKNOWN_ROOT" });
        expect(await raw(other, "release", info.rootId)).toMatchObject({ ok: false, code: "UNKNOWN_ROOT" });
        expect(await raw(env.win, "read", info.rootId, "story.squiffy")).toMatchObject({ ok: true });
    });

    test("paths sent straight to the channels are validated in the main process", async () => {
        const { rootId } = await openRoot();
        const bad = ["../outside/secret.txt", "/etc/passwd", join(outside, "secret.txt"), "..\\outside\\secret.txt", "a/../../outside/secret.txt", "C:\\Windows\\win.ini"];
        for (const p of bad) {
            for (const name of ["read", "exists", "delete", "list"]) {
                expect(await raw(env.win, name, rootId, p)).toMatchObject({ ok: false, code: "INVALID_PATH" });
            }
            expect(await raw(env.win, "write", rootId, p, "pwned")).toMatchObject({ ok: false, code: "INVALID_PATH" });
        }
        expect(await readdir(outside)).toEqual(["secret.txt"]);
        expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("secret");
    });

    test("arguments of the wrong type are refused", async () => {
        const { rootId } = await openRoot();
        for (const p of [42, null, ["story.squiffy"], { path: "story.squiffy" }]) {
            expect(await raw(env.win, "read", rootId, p)).toMatchObject({ ok: false, code: "INVALID_PATH" });
            expect(await raw(env.win, "write", rootId, p, "x")).toMatchObject({ ok: false, code: "INVALID_PATH" });
        }
        for (const data of [42, null, { length: 1 }, [1, 2]]) {
            expect(await raw(env.win, "write", rootId, "x.txt", data)).toMatchObject({ ok: false, code: "IO" });
        }
        expect(await readdir(root)).toEqual(["story.squiffy"]);
    });

    test("pick options of the wrong shape are sanitised", async () => {
        env.dialog.queue.push(root);
        await raw(env.win, "pickFile", { title: 5, filters: [{ description: "x", extensions: [1] }, "junk"], properties: ["multiSelections"] });
        expect(env.dialog.calls[0]).toEqual({ title: undefined, message: undefined, buttonLabel: undefined, properties: ["openFile"], filters: [] });
    });

    test("errors don't reveal absolute paths", async () => {
        const { rootId } = await openRoot();
        const reply = await raw(env.win, "read", rootId, "missing.txt");
        expect(reply).toMatchObject({ ok: false, code: "NOT_FOUND" });
        expect(JSON.stringify(reply)).not.toContain(base);
    });

    test("release and window close forget roots", async () => {
        const a = await openRoot();
        const b = await openRoot();
        await env.bridge.release(a.rootId);
        expect(await raw(env.win, "list", a.rootId)).toMatchObject({ ok: false, code: "UNKNOWN_ROOT" });
        expect(await raw(env.win, "list", b.rootId)).toMatchObject({ ok: true });
        env.win.destroy();
        expect(await raw(env.win, "list", b.rootId)).toMatchObject({ ok: false, code: "UNKNOWN_ROOT" });
    });

    test("approveRoot lets the main process grant a path it trusts", async () => {
        const info = await main.approveRoot(env.win, root);
        expect(await new ElectronFileSystem(env.bridge, info).readText("story.squiffy")).toBe("story");
        await expect(main.approveRoot(env.win, "relative")).rejects.toMatchObject({ code: "INVALID_PATH" });
        await expect(main.approveRoot(env.win, join(root, "story.squiffy"))).rejects.toMatchObject({ code: "NOT_A_DIRECTORY" });
    });

    test("rootPath gives a window's own roots only", async () => {
        const info = await main.approveRoot(env.win, root);
        expect(main.rootPath(env.win, info.rootId)).toBe(info.displayPath);
        const other = new FakeWindow(env.ipcMain);
        expect(main.rootPath(other, info.rootId)).toBeNull();
        expect(main.rootPath(env.win, "nope")).toBeNull();
        expect(main.rootPath(env.win, 42)).toBeNull();
        await env.bridge.release(info.rootId);
        expect(main.rootPath(env.win, info.rootId)).toBeNull();
    });

    test("change events go only to the window watching that root", async () => {
        const info = await openRoot();
        const fs = new ElectronFileSystem(env.bridge, info);
        const other = new FakeWindow(env.ipcMain);
        const otherEvents: unknown[] = [];
        createProjectFsBridge(other.ipcRenderer).onChange((...args) => otherEvents.push(args));
        const seen: string[] = [];
        const stop = fs.watch((changes) => seen.push(...changes.map((c) => c.path)));
        await new Promise((r) => setTimeout(r, 100));
        await writeFile(join(root, "external.squiffy"), "x");
        for (let i = 0; i < 100 && !seen.includes("external.squiffy"); i++) await new Promise((r) => setTimeout(r, 20));
        expect(seen).toContain("external.squiffy");
        expect(otherEvents).toEqual([]);
        stop();
    });

    test("dispose removes every handler", () => {
        main.dispose();
        expect(env.ipcMain.handlers.size).toBe(0);
    });

    test("exposeProjectFs puts the bridge on the main world", () => {
        const exposed: Record<string, unknown> = {};
        exposeProjectFs({ exposeInMainWorld: (k, v) => (exposed[k] = v) }, env.win.ipcRenderer);
        expect(Object.keys(exposed)).toEqual(["projectFs"]);
        expect(typeof (exposed.projectFs as ProjectFsBridge).read).toBe("function");
    });
});

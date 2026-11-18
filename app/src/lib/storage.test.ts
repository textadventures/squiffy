import { describe, expect, test } from "vitest";
import { checkBrowserStorage } from "./storage.js";

describe("checkBrowserStorage", () => {
    test("is ok when getDirectory() resolves", async () => {
        expect(await checkBrowserStorage({ getDirectory: async () => ({}) })).toEqual({ ok: true });
    });

    test("reports the error when getDirectory() rejects, as with a privacy add-on", async () => {
        const result = await checkBrowserStorage({
            getDirectory: () => Promise.reject(new DOMException("The operation is insecure.", "SecurityError")),
        });
        expect(result).toEqual({ ok: false, detail: "SecurityError: The operation is insecure." });
    });

    test("reports an error when getDirectory() throws synchronously", async () => {
        const result = await checkBrowserStorage({ getDirectory: () => { throw new Error("nope"); } });
        expect(result.ok).toBe(false);
    });

    test("is not ok when OPFS or navigator.storage is missing", async () => {
        expect((await checkBrowserStorage({})).ok).toBe(false);
        expect((await checkBrowserStorage(undefined)).ok).toBe(false);
    });
});

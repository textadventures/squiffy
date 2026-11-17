import { describe, expect, test } from "vitest";
import { checkDraftStorage } from "./storage.js";

describe("checkDraftStorage", () => {
    test("is ok when getDirectory() resolves", async () => {
        expect(await checkDraftStorage({ getDirectory: async () => ({}) })).toEqual({ ok: true });
    });

    test("reports the error when getDirectory() rejects, as with a privacy add-on", async () => {
        const result = await checkDraftStorage({
            getDirectory: () => Promise.reject(new DOMException("The operation is insecure.", "SecurityError")),
        });
        expect(result).toEqual({ ok: false, detail: "SecurityError: The operation is insecure." });
    });

    test("reports an error when getDirectory() throws synchronously", async () => {
        const result = await checkDraftStorage({ getDirectory: () => { throw new Error("nope"); } });
        expect(result.ok).toBe(false);
    });

    test("is not ok when OPFS or navigator.storage is missing", async () => {
        expect((await checkDraftStorage({})).ok).toBe(false);
        expect((await checkDraftStorage(undefined)).ok).toBe(false);
    });
});

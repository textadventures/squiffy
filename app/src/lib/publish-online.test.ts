import { describe, expect, test } from "vitest";
import { parseStatus, parseUpload, statusUrl, uploadError, uploadUrl } from "./publish-online.js";

const base = "https://textadventures.co.uk/api/publish/uploads";

describe("uploadUrl", () => {
    test("has the file's name and which editor is publishing", () => {
        expect(uploadUrl(base, "The Cave & the Sea.zip", { source: "web", version: "7.0.0" }))
            .toBe(`${base}?filename=The+Cave+%26+the+Sea.zip&source=web&version=7.0.0`);
    });

    test("with the desktop app's OS", () => {
        expect(uploadUrl(base, "story.zip", { source: "electron", version: "7.1.0-beta.1", platform: "mac" }))
            .toBe(`${base}?filename=story.zip&source=electron&version=7.1.0-beta.1&platform=mac`);
    });
});

describe("statusUrl", () => {
    test("is the upload's own address", () => {
        expect(statusUrl(base, "k3J9_-abc")).toBe(`${base}/k3J9_-abc`);
        expect(statusUrl(`${base}/`, "a/b")).toBe(`${base}/a%2Fb`);
    });
});

describe("parseUpload", () => {
    const upload = { id: "k3J9", claimUrl: "https://textadventures.co.uk/submit/from-editor/k3J9", expires: "2026-11-23T15:00:00Z" };

    test("keeps the ID and where to finish publishing", () => {
        expect(parseUpload(upload)).toEqual({ id: "k3J9", claimUrl: "https://textadventures.co.uk/submit/from-editor/k3J9" });
    });

    test("refuses an answer that isn't as expected", () => {
        expect(parseUpload(null)).toBeNull();
        expect(parseUpload("ok")).toBeNull();
        expect(parseUpload({ ...upload, id: "" })).toBeNull();
        expect(parseUpload({ ...upload, id: 5 })).toBeNull();
        expect(parseUpload({ id: "k3J9" })).toBeNull();
    });

    test("refuses a claim URL that isn't a web page", () => {
        expect(parseUpload({ ...upload, claimUrl: "javascript:alert(1)" })).toBeNull();
        expect(parseUpload({ ...upload, claimUrl: "/submit/from-editor/k3J9" })).toBeNull();
    });
});

describe("parseStatus", () => {
    test("pending", () => {
        expect(parseStatus(200, { status: "pending" })).toEqual({ status: "pending" });
    });

    test("published, with the game's page", () => {
        expect(parseStatus(200, { status: "published", gameId: "abc", gameUrl: "https://textadventures.co.uk/games/view/abc/the-cave" }))
            .toEqual({ status: "published", gameUrl: "https://textadventures.co.uk/games/view/abc/the-cave" });
    });

    test("published, leaving out a link that isn't to a web page", () => {
        expect(parseStatus(200, { status: "published", gameUrl: "javascript:alert(1)" })).toEqual({ status: "published", gameUrl: undefined });
    });

    test("gone, once the upload has expired", () => {
        expect(parseStatus(404, null)).toEqual({ status: "gone" });
    });

    test("nothing, when the site can't say", () => {
        expect(parseStatus(500, null)).toBeNull();
        expect(parseStatus(200, null)).toBeNull();
        expect(parseStatus(200, { status: "something else" })).toBeNull();
    });
});

describe("uploadError", () => {
    test("says what the author can do about it", () => {
        expect(uploadError(413)).toContain("50 MB");
        expect(uploadError(429)).toContain("Wait a while");
        expect(uploadError(0)).toContain("Check you're online");
        expect(uploadError(500)).toContain("error 500");
    });
});

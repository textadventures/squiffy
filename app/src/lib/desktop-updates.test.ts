import { describe, expect, test } from "vitest";
import { BETA_DOWNLOAD_URL, compareVersions, findUpdate, STABLE_DOWNLOAD_URL, type Release } from "./desktop-updates.svelte.js";

describe("compareVersions", () => {
    test.each([
        ["7.0.0", "7.0.1", -1],
        ["7.1.0", "7.0.9", 1],
        ["v7.0.0", "7.0.0", 0],
        ["7.0.0-beta.2", "7.0.0", -1],
        ["7.0.0", "7.0.0-beta.9", 1],
        ["7.0.0-beta.2", "7.0.0-beta.10", -1],
        ["7.0.0-beta.2", "7.0.0-beta.2", 0],
        ["7.0.0-alpha.3", "7.0.0-beta.1", -1],
        ["7.0.0-beta", "7.0.0-beta.1", -1],
        ["6.9.9", "7.0.0-beta.1", -1],
    ])("%s vs %s", (a, b, sign) => {
        expect(Math.sign(compareVersions(a, b))).toBe(sign);
    });
});

const release = (tag: string, assets: string[], extra: Partial<Release> = {}): Release => ({
    tag_name: tag,
    prerelease: tag.includes("-"),
    assets: assets.map(name => ({ name })),
    ...extra,
});

describe("findUpdate", () => {
    const releases = [
        release("v7.1.0-beta.1", ["Squiffy.Beta-7.1.0-beta.1-arm64.dmg"]),
        release("v7.0.1", ["Squiffy-7.0.1-arm64.dmg", "Squiffy.Setup.7.0.1.exe"]),
        release("v7.0.0", ["Squiffy-7.0.0-arm64.dmg", "Squiffy.Setup.7.0.0.exe", "squiffy-desktop_7.0.0_amd64.deb"]),
        release("v6.0.2", []),
    ];

    test("the stable app is told about the newest stable release", () => {
        expect(findUpdate(releases, "7.0.0", "mac")).toEqual({ version: "7.0.1", url: STABLE_DOWNLOAD_URL });
    });

    test("the beta is told about prereleases too", () => {
        expect(findUpdate(releases, "7.0.1-beta.3", "mac")).toEqual({ version: "7.1.0-beta.1", url: BETA_DOWNLOAD_URL });
    });

    test("the beta is told about the stable release that ends its series", () => {
        expect(findUpdate([release("v7.0.0", ["Squiffy-7.0.0-arm64.dmg"])], "7.0.0-beta.5", "mac")).toEqual({ version: "7.0.0", url: STABLE_DOWNLOAD_URL });
    });

    test("only releases with an installer for this platform count", () => {
        expect(findUpdate(releases, "7.0.0", "linux")).toBeNull();
        expect(findUpdate(releases, "6.9.0", "linux")?.version).toBe("7.0.0");
    });

    test("nothing when up to date, and drafts are left out", () => {
        expect(findUpdate(releases, "7.0.1", "windows")).toBeNull();
        expect(findUpdate([release("v7.0.2", ["Squiffy.Setup.7.0.2.exe"], { draft: true })], "7.0.1", "windows")).toBeNull();
    });
});

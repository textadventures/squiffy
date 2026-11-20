import { describe, expect, test } from "vitest";
import { buildLinks, detectOs, type Release } from "./download-links.js";

const asset = (name: string) => ({ name, browser_download_url: `https://example.com/${name}` });

const release: Release = {
    tag_name: "v7.0.0",
    published_at: "2026-11-01T12:00:00Z",
    html_url: "https://github.com/textadventures/squiffy/releases/tag/v7.0.0",
    assets: [
        asset("Squiffy-7.0.0-arm64.dmg"),
        asset("Squiffy-Setup-7.0.0.exe"),
        asset("Squiffy-7.0.0.AppImage"),
        asset("squiffy-desktop_7.0.0_amd64.deb"),
        asset("Squiffy-7.0.0-arm64.AppImage"),
        asset("squiffy-desktop_7.0.0_arm64.deb"),
        asset("latest-mac.yml"),
    ],
};

describe("download links", () => {
    test("detects the visitor's system", () => {
        expect(detectOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Mac");
        expect(detectOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows");
        expect(detectOs("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Linux");
        expect(detectOs("Mozilla/5.0 (CrOS)")).toBeNull();
    });

    test("puts the installer for this system first", () => {
        const links = buildLinks(release, "Mac");
        expect(links.version).toBe("v7.0.0");
        expect(links.primary).toEqual({ label: "Download for Mac (Apple Silicon)", url: "https://example.com/Squiffy-7.0.0-arm64.dmg" });
        expect(links.others.map(l => l.label)).toEqual(["Windows", "Linux (.deb)", "Linux (AppImage)", "Linux on Arm (.deb)", "Linux on Arm (AppImage)"]);
    });

    test("prefers the x64 .deb on Linux", () => {
        const links = buildLinks(release, "Linux");
        expect(links.primary?.url).toBe("https://example.com/squiffy-desktop_7.0.0_amd64.deb");
        expect(links.others.map(l => l.label)).toContain("Linux (AppImage)");
    });

    test("has no primary link for an unknown system", () => {
        const links = buildLinks(release, null);
        expect(links.primary).toBeNull();
        expect(links.others).toHaveLength(6);
    });
});

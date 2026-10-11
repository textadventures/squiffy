import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { convertV5File } from "./convert-v5.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_DIR = path.join(__dirname, "..", "test-fixtures-convert-v5");
const storyFile = path.join(TEST_DIR, "story.squiffy");
const backupFile = storyFile + ".bak";

beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("convertV5File", () => {
    test("converts the file and keeps a backup", async () => {
        const original = "[[a]]:\n{if x:yes}{else:no} {x}";
        await fs.writeFile(storyFile, original);

        expect(convertV5File(storyFile)).toBe(true);

        expect(await fs.readFile(storyFile, "utf8")).toBe("[[a]]:\n{{#if x}}yes{{else}}no{{/if}} {{x}}");
        expect(await fs.readFile(backupFile, "utf8")).toBe(original);
    });

    test("reports what it couldn't convert", async () => {
        await fs.writeFile(storyFile, "[[a]]:\n{x}\n{@x*=2}");

        expect(convertV5File(storyFile)).toBe(true);

        expect(await fs.readFile(storyFile, "utf8")).toBe("[[a]]:\n{{x}}\n{@x*=2}");
        expect(console.warn).toHaveBeenCalledWith("  line 3: {@x*=2}");
    });

    test("doesn't write anything when there's nothing to convert", async () => {
        await fs.writeFile(storyFile, "[[a]]:\n{{x}}");

        expect(convertV5File(storyFile)).toBe(true);

        await expect(fs.access(backupFile)).rejects.toThrow();
        expect(console.log).toHaveBeenCalledWith("No Squiffy 5 text processor syntax found.");
    });

    test("doesn't overwrite an existing backup", async () => {
        await fs.writeFile(storyFile, "[[a]]:\n{x}");
        await fs.writeFile(backupFile, "old backup");

        expect(convertV5File(storyFile)).toBe(false);

        expect(await fs.readFile(storyFile, "utf8")).toBe("[[a]]:\n{x}");
        expect(await fs.readFile(backupFile, "utf8")).toBe("old backup");
    });
});

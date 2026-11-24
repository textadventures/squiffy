import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { convertV5File } from "./convert-v5.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_DIR = path.join(__dirname, "..", "test-fixtures-convert-v5");
const storyFile = path.join(TEST_DIR, "story.squiffy");
const backupFile = storyFile + ".bak";
const projectFile = path.join(TEST_DIR, "squiffy.json");
const exists = (file: string) => fs.access(file).then(() => true, () => false);

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

        expect(await convertV5File(storyFile)).toBe(true);

        expect(await fs.readFile(storyFile, "utf8")).toBe("[[a]]:\n{{#if x}}yes{{else}}no{{/if}} {{x}}");
        expect(await fs.readFile(backupFile, "utf8")).toBe(original);
    });

    test("then converts the setters and adds a squiffy.json, keeping the original as the backup", async () => {
        // --convert-v6 on its own would refuse, as the first step's .bak is in the way (#643)
        const original = "[[a]]:\n@set weapon = sword\n{if weapon=sword:You have a sword.}\n[[Go]](b, gold=5)\n\n[[b]]:\nDone.";
        await fs.writeFile(storyFile, original);

        expect(await convertV5File(storyFile)).toBe(true);

        expect(await fs.readFile(storyFile, "utf8")).toBe("[[a]]:\n@set weapon = \"sword\"\n{{#if weapon = \"sword\"}}You have a sword.{{/if}}\n[[Go]](b, gold=5)\n\n[[b]]:\nDone.");
        expect(await fs.readFile(backupFile, "utf8")).toBe(original);
        expect(await exists(projectFile)).toBe(true);
    });

    test("converts the setters of a story with no Squiffy 5 text processor syntax", async () => {
        await fs.writeFile(storyFile, "[[a]]:\n@set weapon = sword");

        expect(await convertV5File(storyFile)).toBe(true);

        expect(await fs.readFile(storyFile, "utf8")).toBe("[[a]]:\n@set weapon = \"sword\"");
        expect(await fs.readFile(backupFile, "utf8")).toBe("[[a]]:\n@set weapon = sword");
        expect(await exists(projectFile)).toBe(true);
    });

    test("leaves the setters of a story that already has a squiffy.json", async () => {
        await fs.writeFile(projectFile, "{}");
        await fs.writeFile(storyFile, "[[a]]:\n@set weapon = \"sword\"\n{x}");

        expect(await convertV5File(storyFile)).toBe(true);

        expect(await fs.readFile(storyFile, "utf8")).toBe("[[a]]:\n@set weapon = \"sword\"\n{{x}}");
        expect(await fs.readFile(projectFile, "utf8")).toBe("{}");
    });

    test("reports what it couldn't convert", async () => {
        await fs.writeFile(storyFile, "[[a]]:\n{x}\n{@x*=2}");

        expect(await convertV5File(storyFile)).toBe(true);

        expect(await fs.readFile(storyFile, "utf8")).toBe("[[a]]:\n{{x}}\n{@x*=2}");
        expect(console.warn).toHaveBeenCalledWith("  line 3: {@x*=2}");
        // The setters wait until that's fixed
        expect(await exists(projectFile)).toBe(false);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("run with --convert-v6"));
    });

    test("doesn't change the file when there's nothing to convert", async () => {
        await fs.writeFile(storyFile, "[[a]]:\n{{x}}");

        expect(await convertV5File(storyFile)).toBe(true);

        expect(await fs.readFile(storyFile, "utf8")).toBe("[[a]]:\n{{x}}");
        expect(await exists(backupFile)).toBe(false);
        expect(console.log).toHaveBeenCalledWith("No Squiffy 5 text processor syntax found.");
    });

    test("doesn't overwrite an existing backup", async () => {
        await fs.writeFile(storyFile, "[[a]]:\n{x}");
        await fs.writeFile(backupFile, "old backup");

        expect(await convertV5File(storyFile)).toBe(false);

        expect(await fs.readFile(storyFile, "utf8")).toBe("[[a]]:\n{x}");
        expect(await fs.readFile(backupFile, "utf8")).toBe("old backup");
    });
});

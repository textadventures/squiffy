import { describe, expect, test, vi } from "vitest";
import { folderOf, Stories, type StoryHost, toPath, toUri } from "./stories.js";

describe("URIs and project paths", () => {
    const root = "file:///Users/me/My%20Story/";

    test("maps a URI in the folder to a path, decoded", () => {
        expect(toPath(root, "file:///Users/me/My%20Story/chapters/one%20%281%29.squiffy")).toBe("chapters/one (1).squiffy");
        expect(toPath(root, "file:///Users/me/Other/a.squiffy")).toBeUndefined();
        expect(toPath(root, root)).toBeUndefined();
    });

    test("maps a path to a URI encoded as VS Code encodes it", () => {
        expect(toUri(root, "chapters/one (1).squiffy")).toBe("file:///Users/me/My%20Story/chapters/one%20%281%29.squiffy");
    });

    test("finds a file's folder", () => {
        expect(folderOf("file:///a/b/c.squiffy")).toBe("file:///a/b/");
    });
});

// A workspace of files by URI
function host(files: Record<string, string>): StoryHost & { files: Record<string, string> } {
    return {
        files,
        findProjectFiles: vi.fn(async () => Object.keys(files).filter(uri => uri.endsWith("/squiffy.json"))),
        listFiles: async root => Object.keys(files).filter(uri => uri.startsWith(root)).map(uri => toPath(root, uri)!),
        readText: async uri => {
            if (!(uri in files)) throw new Error(`No file ${uri}`);
            return files[uri];
        },
    };
}

describe("stories", () => {
    test("a folder with a squiffy.json is one story, with files in its subfolders", async () => {
        const stories = new Stories(host({
            "file:///w/game/squiffy.json": JSON.stringify({ version: 1, main: "main.squiffy" }),
            "file:///w/game/main.squiffy": "[[start]]:\nGo to [[cellar]].",
            "file:///w/game/rooms/cellar.squiffy": "[[cellar]]:\nDark.",
        }));
        const main = await stories.storyFor("file:///w/game/main.squiffy");
        const cellar = await stories.storyFor("file:///w/game/rooms/cellar.squiffy");
        expect(cellar).toBe(main);
        expect(main.project).toBe(true);
        const diagnostics = await main.service.getAllDiagnostics();
        expect(diagnostics.filter(d => d.code == "squiffy/unknown-section-link")).toEqual([]);
    });

    test("a file elsewhere is part of the story in its folder, from the first file opened", async () => {
        const stories = new Stories(host({
            "file:///w/old/story.squiffy": "@import other.squiffy\n[[start]]:\nGo to [[next]].",
            "file:///w/old/other.squiffy": "[[next]]:\nThe end.",
        }));
        const story = await stories.setOpenText("file:///w/old/story.squiffy", "@import other.squiffy\n[[start]]:\nGo to [[next]].");
        expect(story.project).toBe(false);
        expect((await story.service.getProjectInfo()).mainFile).toBe("story.squiffy");
        expect(await stories.storyFor("file:///w/old/other.squiffy")).toBe(story);
    });

    test("uses open files' text", async () => {
        const stories = new Stories(host({ "file:///w/a.squiffy": "Saved." }));
        const story = await stories.setOpenText("file:///w/a.squiffy", "[[start]]:\nGo to [[missing]].");
        const diagnostics = await story.service.getAllDiagnostics();
        expect(diagnostics.map(d => d.code)).toContain("squiffy/unknown-section-link");
    });

    test("starts again when a squiffy.json is added", async () => {
        const files: Record<string, string> = { "file:///w/game/main.squiffy": "Hello." };
        const stories = new Stories(host(files));
        const before = await stories.storyFor("file:///w/game/main.squiffy");
        expect(before.project).toBe(false);

        // Another file changing doesn't
        expect(await stories.fileChanged("file:///w/game/main.squiffy")).toEqual([before]);

        files["file:///w/game/squiffy.json"] = JSON.stringify({ version: 1, main: "main.squiffy" });
        expect(await stories.fileChanged("file:///w/game/squiffy.json")).toBe("reset");
        const after = await stories.storyFor("file:///w/game/main.squiffy");
        expect(after.project).toBe(true);
    });

    test("only sets the main file without a squiffy.json", async () => {
        const stories = new Stories(host({
            "file:///w/game/squiffy.json": JSON.stringify({ version: 1, main: "main.squiffy" }),
            "file:///w/game/main.squiffy": "Hello.",
            "file:///w/old/a.squiffy": "A.",
            "file:///w/old/b.squiffy": "B.",
        }));
        expect(await stories.setMainFile("file:///w/game/main.squiffy")).toBeUndefined();
        await stories.storyFor("file:///w/old/a.squiffy");
        const story = await stories.setMainFile("file:///w/old/b.squiffy");
        expect((await story!.service.getProjectInfo()).mainFile).toBe("b.squiffy");
    });
});

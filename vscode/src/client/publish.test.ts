import { describe, expect, test, vi } from "vitest";
import type { PublishStatus } from "@textadventures/squiffy-app/publish-api";

vi.mock("vscode", () => ({ UIKind: { Desktop: 1, Web: 2 } }));
const { projectFileMessage, publishClient, waitForPublishing, withStoryId } = await import("./publish.js");

describe("withStoryId", () => {
    test("adds an ID after the version, keeping the rest", () => {
        const text = "{\n  \"$schema\": \"https://squiffystory.com/schema/squiffy.json\",\n  \"version\": 1,\n  \"main\": \"story.squiffy\",\n  \"title\": \"The Cave\"\n}\n";
        expect(withStoryId(text, "abc-123")).toBe(
            "{\n  \"$schema\": \"https://squiffystory.com/schema/squiffy.json\",\n  \"version\": 1,\n  \"id\": \"abc-123\",\n  \"main\": \"story.squiffy\",\n  \"title\": \"The Cave\"\n}\n");
    });

    test("an empty ID is replaced", () => {
        expect(JSON.parse(withStoryId("{\"version\": 1, \"id\": \" \"}", "abc")!).id).toBe("abc");
    });

    test("is null for a story that has an ID, and undefined for one that can't be read", () => {
        expect(withStoryId("{\"version\": 1, \"id\": \"old\"}", "new")).toBeNull();
        expect(withStoryId("{", "new")).toBeUndefined();
        expect(withStoryId("[]", "new")).toBeUndefined();
    });
});

test("publishClient says it's VS Code, and which", () => {
    expect(publishClient("7.0.0", 2)).toEqual({ source: "vscode", version: "7.0.0", platform: "web" });
    expect(publishClient("7.0.0", 1)).toEqual({ source: "vscode", version: "7.0.0", platform: "desktop" });
});

describe("waitForPublishing", () => {
    const answers = (...statuses: (PublishStatus | null)[]) => vi.fn(async () => statuses.shift() ?? null);

    test("asks until the story's published, past a moment the site couldn't answer", async () => {
        const check = answers({ status: "pending" }, null, { status: "published", gameUrl: "https://textadventures.co.uk/games/view/x" });
        await expect(waitForPublishing("k3J9", new AbortController().signal, { check, interval: 1 }))
            .resolves.toEqual({ status: "published", gameUrl: "https://textadventures.co.uk/games/view/x" });
        expect(check).toHaveBeenCalledTimes(3);
        expect(check).toHaveBeenCalledWith("k3J9");
    });

    test("stops when the upload's gone", async () => {
        await expect(waitForPublishing("k3J9", new AbortController().signal, { check: answers({ status: "gone" }), interval: 1 })).resolves.toEqual({ status: "gone" });
    });

    test("stops when told to, or after a while", async () => {
        const abort = new AbortController();
        const check = vi.fn(async (): Promise<PublishStatus> => {
            abort.abort();
            return { status: "pending" };
        });
        await expect(waitForPublishing("k3J9", abort.signal, { check, interval: 1 })).resolves.toBeUndefined();
        expect(check).toHaveBeenCalledTimes(1);
        await expect(waitForPublishing("k3J9", new AbortController().signal, { check: answers(), interval: 5, timeout: 20 })).resolves.toBeUndefined();
    });
});

describe("projectFileMessage", () => {
    test("says what the new squiffy.json leaves out, and what was converted", () => {
        expect(projectFileMessage({ exclude: [], converted: 0, problems: [] })).toBe("Added squiffy.json, so textadventures.co.uk knows next time that it's the same story.");
        const message = projectFileMessage({ exclude: ["a.squiffy", "b.squiffy", "c.css", "d.js"], converted: 2, problems: [] });
        expect(message).toContain(" It leaves out the folder's files that aren't part of this story: a.squiffy, b.squiffy, c.css and 1 more.");
        expect(message).toContain(" Converted 2 setters to Squiffy 7's rules");
    });
});

import { test, expect, type Page } from "@playwright/test";

// The story map in the editor: writing a section beside the full-screen map (#542), and editing
// from the map. Each test starts a new story in the browser and replaces its text.

const story = `@title Test

[[start]]:
Go to the [[cave]] or the [[hill]].

[[cave]]:
It's dark. Look at the [wall], or go to the [[hill]].

[wall]:
Damp.

[[empty]]:

[[hill]]:
@end
The end. [[empty]]
`;

const editor = (page: Page) => page.locator("#editor .cm-content:visible");
const map = (page: Page) => page.getByRole("application", { name: "Story map" });
const box = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);
const cardTitle = (page: Page) => page.locator("#editor header h2");

// The lines the editor shows: the whole script, or the section in the card
async function lines(page: Page) {
    return (await editor(page).locator(".cm-line").allInnerTexts()).map(line => line.replace(/\n$/, ""));
}

async function openStory(page: Page, text = story) {
    await page.goto("/");
    await page.getByText("New story").click();
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText(text.trimEnd());
    const last = text.trimEnd().split("\n").pop()!;
    await expect(editor(page)).toContainText(last);
    await page.getByRole("button", { name: "Story map" }).click();
    await page.getByRole("button", { name: "Full screen" }).click();
    await expect(page.locator("[data-node]").first()).toBeVisible();
}

// Opens a section beside the map, by selecting its box and pressing Enter
async function write(page: Page, id: string) {
    await box(page, id).click();
    await page.keyboard.press("Enter");
    await expect(editor(page)).toBeFocused();
}

// Back to the whole script, from the card
async function wholeScript(page: Page) {
    await page.getByRole("button", { name: "Show in the whole script" }).click();
    await expect(page.getByRole("button", { name: "Show in the whole script" })).toBeHidden();
    return (await lines(page)).join("\n");
}

test.describe("writing on the map", () => {
    test("shows a section with its passages, and nothing else", async ({ page }) => {
        await openStory(page);
        await write(page, "section:cave");
        await expect(cardTitle(page)).toHaveText("cave");
        expect(await lines(page)).toEqual(["It's dark. Look at the [wall], or go to the [[hill]].", "", "[wall]:", "Damp."]);
        await expect(editor(page)).toBeFocused();
    });

    test("double-clicking a box opens it too", async ({ page }) => {
        await openStory(page);
        await box(page, "section:hill").dblclick();
        await expect(cardTitle(page)).toHaveText("hill");
        await expect(box(page, "section:hill")).toHaveClass(/gm-selected|selected/);
    });

    test("typing stays in the section, and the rest of the script is untouched", async ({ page }) => {
        await openStory(page);
        await write(page, "section:cave");
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.type("Rewritten.");
        expect(await lines(page)).toEqual(["Rewritten."]);
        // Backspace at the start can't join it to the header, nor Delete at the end pull up
        // what follows
        await page.keyboard.press("ControlOrMeta+Home");
        await page.keyboard.press("Backspace");
        await page.keyboard.press("ControlOrMeta+End");
        await page.keyboard.press("Delete");
        expect(await wholeScript(page)).toBe(story.trimEnd().replace(/It's dark[^]*Damp\./, "Rewritten."));
    });

    test("an empty section gets a blank line after what's written in it", async ({ page }) => {
        await openStory(page);
        await write(page, "section:empty");
        expect(await lines(page)).toEqual([""]);
        await page.keyboard.type("Not any more.");
        expect(await wholeScript(page)).toContain("[[empty]]:\nNot any more.\n\n[[hill]]:");
    });

    test("selecting another box shows that one, and a passage shows its section", async ({ page }) => {
        await openStory(page);
        await write(page, "section:cave");
        await page.keyboard.press("Escape");
        await expect(map(page)).toBeFocused();
        await box(page, "section:hill").click();
        await expect(cardTitle(page)).toHaveText("hill");
        expect(await lines(page)).toEqual(["@end", "The end. [[empty]]"]);
        await box(page, "passage:cave/wall").click();
        await expect(cardTitle(page)).toHaveText("cave");
        await expect(editor(page).locator(".cm-activeLine")).toHaveText("[wall]:");
    });

    test("F12 on a link goes to its section, in the card and on the map", async ({ page }) => {
        await openStory(page);
        await write(page, "section:cave");
        // Into the [[hill]] link at the end of the first line
        await page.keyboard.press("ControlOrMeta+Home");
        await page.keyboard.press("End");
        for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("F12");
        await expect(cardTitle(page)).toHaveText("hill");
        expect(await lines(page)).toEqual(["@end", "The end. [[empty]]"]);
        await expect(page.getByText("Section: hill")).toBeVisible();
        // And to a passage in the same section
        await write(page, "section:cave");
        await page.keyboard.press("ControlOrMeta+Home");
        for (let i = 0; i < 26; i++) await page.keyboard.press("ArrowRight");
        await page.keyboard.press("F12");
        await expect(cardTitle(page)).toHaveText("cave");
        await expect(editor(page).locator(".cm-activeLine")).toHaveText("[wall]:");
    });

    test("renaming from the card changes the links to it", async ({ page }) => {
        await openStory(page);
        await write(page, "section:cave");
        await page.locator("#editor header").getByRole("button", { name: "Rename" }).click();
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.type("grotto");
        await page.keyboard.press("Enter");
        await expect(cardTitle(page)).toHaveText("grotto");
        expect(await lines(page)).toEqual(["It's dark. Look at the [wall], or go to the [[hill]].", "", "[wall]:", "Damp."]);
        const script = await wholeScript(page);
        expect(script).toContain("Go to the [[grotto]] or the [[hill]].");
        expect(script).toContain("[[grotto]]:\nIt's dark.");
    });

    test("undo in the card undoes what was typed there", async ({ page }) => {
        await openStory(page);
        await write(page, "section:hill");
        await page.keyboard.press("ControlOrMeta+End");
        await page.keyboard.type(" Really.");
        expect(await lines(page)).toEqual(["@end", "The end. [[empty]] Really."]);
        await page.keyboard.press("ControlOrMeta+Z");
        expect(await lines(page)).toEqual(["@end", "The end. [[empty]]"]);
    });

    test("closing the card, or leaving full screen, shows the whole script again", async ({ page }) => {
        await openStory(page);
        await write(page, "section:cave");
        await page.locator("#editor header").getByRole("button", { name: "Close" }).click();
        await expect(page.locator("#editor")).toBeHidden();
        await write(page, "section:cave");
        await page.getByRole("button", { name: "Show the editor" }).click();
        expect((await lines(page)).join("\n")).toBe(story.trimEnd());
    });

    test("the text before the first section can be written too", async ({ page }) => {
        await openStory(page, "@title Test\nHello. [[on]]\n\n[[on]]:\n@end\nDone.\n");
        await write(page, "section:_default");
        await expect(cardTitle(page)).toHaveText("(Start)");
        expect(await lines(page)).toEqual(["@title Test", "Hello. [[on]]"]);
    });
});

test.describe("editing from the map", () => {
    test("Delete removes a section, and undo brings it back", async ({ page }) => {
        await openStory(page);
        await box(page, "section:cave").click();
        await page.keyboard.press("Delete");
        await expect(page.getByText('Delete the section "cave"? Its passage goes too. 1 link to it will be broken.')).toBeVisible();
        await page.getByRole("button", { name: "Delete", exact: true }).last().click();
        await expect(box(page, "section:cave")).toHaveCount(0);
        await map(page).focus();
        await page.keyboard.press("ControlOrMeta+Z");
        await expect(box(page, "section:cave")).toBeVisible();
    });

    test("a passage added from the menu goes at the end of its section, with a link", async ({ page }) => {
        await openStory(page);
        await box(page, "section:cave").click({ button: "right" });
        await page.getByRole("menuitem", { name: "Add a passage…" }).click();
        await page.keyboard.type("floor");
        await page.keyboard.press("Enter");
        await expect(box(page, "passage:cave/floor")).toBeVisible();
        await page.getByRole("button", { name: "Show the editor" }).click();
        expect((await lines(page)).join("\n")).toContain("go to the [[hill]].\n\n[floor]\n\n[wall]:\nDamp.\n\n[floor]:\n\n[[empty]]:");
    });
});

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
    await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Map", exact: true }).click();
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

    test("the card's left edge can be dragged to make it wider or narrower", async ({ page }) => {
        await openStory(page);
        await write(page, "section:cave");
        const card = page.locator("#editor");
        const before = (await card.boundingBox())!;
        const edge = page.getByRole("separator", { name: "Resize the section" });
        const e = (await edge.boundingBox())!;
        await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
        await page.mouse.down();
        await page.mouse.move(e.x + e.width / 2 - 100, e.y + e.height / 2, { steps: 5 });
        await page.mouse.up();
        const wider = (await card.boundingBox())!;
        expect(Math.round(wider.width - before.width)).toBe(100);
        expect(Math.round(wider.x + wider.width)).toBe(Math.round(before.x + before.width));
        // It stays that width for the next section
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await write(page, "section:hill");
        await expect(cardTitle(page)).toHaveText("hill");
        expect(Math.round((await card.boundingBox())!.width)).toBe(Math.round(wider.width));
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

    test("closing the card, or leaving the map-only view, shows the whole script again", async ({ page }) => {
        await openStory(page);
        await write(page, "section:cave");
        await page.locator("#editor header").getByRole("button", { name: "Close" }).click();
        await expect(page.locator("#editor")).toBeHidden();
        await write(page, "section:cave");
        await page.getByRole("button", { name: "Code + Map", exact: true }).click();
        expect((await lines(page)).join("\n")).toBe(story.trimEnd());
    });

    test("the problems list shows under the map, and a problem opens beside it", async ({ page }) => {
        await openStory(page, story.replace("Damp.", "Damp. Back to [[nowhere]]."));
        await page.getByRole("button", { name: /^Problems:/ }).click();
        const problem = page.getByRole("region", { name: "Problems" }).locator("button.problem", { hasText: "nowhere" });
        await expect(problem).toBeVisible();
        await problem.click();
        // The section the problem's in, with the cursor on it
        await expect(cardTitle(page)).toHaveText("cave");
        await expect(editor(page)).toBeFocused();
        await expect(page.locator("#editor .cm-activeLine")).toContainText("Back to [[nowhere]].");
    });

    test("clicking a link's line shows the link beside the map", async ({ page }) => {
        await openStory(page, "[[start]]:\nGo to the [[cave]].\n\n[[cave]]:\nIt's dark.");
        const from = (await box(page, "section:start").boundingBox())!;
        const to = (await box(page, "section:cave").boundingBox())!;
        await page.mouse.click((from.x + from.width / 2 + to.x + to.width / 2) / 2, (from.y + from.height / 2 + to.y + to.height / 2) / 2);
        await expect(cardTitle(page)).toHaveText("start");
        await expect(page.locator("#editor .cm-activeLine")).toContainText("Go to the [[cave]].");
        // Still the map, not the whole script
        await expect(map(page)).toBeVisible();
    });

    test("Find and Replace only search the section being written", async ({ page }) => {
        await openStory(page);
        await write(page, "section:cave");
        await page.keyboard.press("ControlOrMeta+F");
        await page.locator("#editor input[name=search]").fill("hill");
        // The script has [[hill]] in three places, and one of them is in the cave
        await expect(page.locator("#editor .ed-search-count")).toHaveText("1 of 1");
        await page.locator("#editor button[name=expand]").click();
        await page.locator("#editor input[name=replace]").fill("mountain");
        await page.locator("#editor button[name=replaceAll]").click();
        await page.keyboard.press("Escape");
        const script = await wholeScript(page);
        expect(script).toContain("or go to the [[mountain]].");
        expect(script).toContain("Go to the [[cave]] or the [[hill]].");
        expect(script).toContain("[[hill]]:");
    });

    test("Add, in the toolbar, makes the selected text a link to a new section, which isn't shown in the card", async ({ page }) => {
        await openStory(page);
        await write(page, "section:cave");
        await page.keyboard.press("ControlOrMeta+Home");
        await page.keyboard.type("A tunnel. ");
        for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowLeft");
        for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowLeft");
        await page.getByRole("button", { name: "Add", exact: true }).click();
        await page.getByRole("menuitem", { name: "Section", exact: true }).click();
        await expect(box(page, "section:tunnel")).toBeVisible();
        // Still the cave, with the link, and without the new section's header under it
        await expect(cardTitle(page)).toHaveText("cave");
        await expect(async () => {
            expect(await lines(page)).toEqual(["A [[tunnel]]. It's dark. Look at the [wall], or go to the [[hill]].", "", "[wall]:", "Damp."]);
        }).toPass();
        expect(await wholeScript(page)).toContain("[wall]:\nDamp.\n\n[[tunnel]]:\n\n[[empty]]:");
    });

    test("with nothing selected, Add asks for the name on the map", async ({ page }) => {
        await openStory(page);
        await write(page, "section:cave");
        await page.getByRole("button", { name: "Add", exact: true }).click();
        await page.getByRole("menuitem", { name: "Section", exact: true }).click();
        await expect(page.getByRole("textbox", { name: "New section's name" })).toBeFocused();
        await page.keyboard.type("pool");
        await page.keyboard.press("Enter");
        await expect(box(page, "section:pool")).toBeVisible();
        // The new section's selected, so it's the one to write now
        await expect(cardTitle(page)).toHaveText("pool");
        await page.getByRole("button", { name: "Add", exact: true }).click();
        await page.getByRole("menuitem", { name: "Passage", exact: true }).click();
        await expect(page.getByRole("textbox", { name: "New passage's name" })).toBeFocused();
        await page.keyboard.type("drip");
        await page.keyboard.press("Enter");
        await expect(box(page, "passage:pool/drip")).toBeVisible();
        await expect(async () => expect(await lines(page)).toEqual(["[drip]", "", "[drip]:"])).toPass();
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

    test("selecting a box, or opening one to write in, leaves the others where they are", async ({ page }) => {
        await openStory(page);
        // Where the other boxes are: the selected one grows an outline and a dot to drag
        const middle = async (id: string) => {
            const b = (await box(page, id).boundingBox())!;
            return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
        };
        const others = async () => [await middle("section:cave"), await middle("section:hill")];
        const before = await others();
        await box(page, "section:start").click();
        await expect(page.getByText("Section: start")).toBeVisible();
        expect(await others()).toEqual(before);
        await page.keyboard.press("Enter");
        await expect(cardTitle(page)).toHaveText("start");
        expect(await others()).toEqual(before);
    });

    test("a section dragged out from another, then deleted, leaves nothing behind", async ({ page }) => {
        await openStory(page);
        const script = async () => {
            await page.getByRole("button", { name: "Code + Map", exact: true }).click();
            const text = (await lines(page)).join("\n");
            await page.getByRole("button", { name: "Map", exact: true }).click();
            return text;
        };
        await box(page, "section:hill").click();
        const handle = await page.locator('[data-handle="section:hill"]').boundingBox();
        await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
        await page.mouse.down();
        await page.mouse.move(120, 300, { steps: 5 });
        await page.mouse.up();
        await page.keyboard.type("summit");
        await page.keyboard.press("Enter");
        await expect(box(page, "section:summit")).toBeVisible();
        expect(await script()).toBe(`${story.trimEnd()}\n\n[[summit]]\n\n[[summit]]:\n`);

        await box(page, "section:summit").click();
        await page.keyboard.press("Delete");
        await expect(page.getByText('Delete the section "summit"? The link to it on a line of its own goes too.')).toBeVisible();
        await page.getByRole("button", { name: "Delete", exact: true }).last().click();
        await expect(box(page, "section:summit")).toHaveCount(0);
        // No red box for a link left behind
        await expect(page.locator('[data-node^="missing:"]')).toHaveCount(0);
        expect(await script()).toBe(`${story.trimEnd()}\n`);
    });

    test("a passage added from the menu goes at the end of its section, with a link", async ({ page }) => {
        await openStory(page);
        await box(page, "section:cave").click({ button: "right" });
        await page.getByRole("menuitem", { name: "Add a passage…" }).click();
        await page.keyboard.type("floor");
        await page.keyboard.press("Enter");
        await expect(box(page, "passage:cave/floor")).toBeVisible();
        await page.getByRole("button", { name: "Code + Map", exact: true }).click();
        expect((await lines(page)).join("\n")).toContain("go to the [[hill]].\n\n[floor]\n\n[wall]:\nDamp.\n\n[floor]:\n\n[[empty]]:");
    });

    test("a new section is named where its box will be", async ({ page }) => {
        await openStory(page);
        await map(page).dblclick({ position: { x: 60, y: 60 } });
        const name = page.getByRole("textbox", { name: "New section's name" });
        await expect(name).toBeFocused();
        // A name that's taken is refused, and the box stays to try again
        await page.keyboard.type("cave");
        await page.keyboard.press("Enter");
        await expect(page.getByRole("alert")).toHaveText("There's already a section called 'cave'.");
        await name.fill("meadow");
        await page.keyboard.press("Enter");
        await expect(name).toBeHidden();
        await expect(box(page, "section:meadow")).toBeVisible();
        await expect(map(page)).toBeFocused();
        // Escape gives up
        await map(page).dblclick({ position: { x: 60, y: 60 } });
        await page.keyboard.type("never");
        await page.keyboard.press("Escape");
        await expect(name).toBeHidden();
        await expect(box(page, "section:never")).toHaveCount(0);
    });

    test("F2 renames a box where it is", async ({ page }) => {
        await openStory(page);
        await box(page, "section:cave").click();
        await page.keyboard.press("F2");
        const name = page.getByRole("textbox", { name: "New name for cave" });
        await expect(name).toHaveValue("cave");
        await page.keyboard.type("grotto");
        await page.keyboard.press("Enter");
        await expect(box(page, "section:grotto")).toBeVisible();
        await expect(box(page, "section:cave")).toHaveCount(0);
        await expect(box(page, "passage:grotto/wall")).toBeVisible();
    });

    test("double-clicking a broken link's red box adds what's missing", async ({ page }) => {
        await openStory(page, "[[start]]:\nGo [[nowhere]], or look at the [sky].\n\n[[end]]:\n@end\nDone. [[start]]\n");
        await page.locator('[data-node$="link:nowhere"]').dblclick();
        await expect(box(page, "section:nowhere")).toBeVisible();
        await page.locator('[data-node$="link:sky"]').dblclick();
        await expect(box(page, "passage:start/sky")).toBeVisible();
        await expect(page.locator('[data-node^="missing:"]')).toHaveCount(0);
        await page.getByRole("button", { name: "Code + Map", exact: true }).click();
        // No second link, and each goes where it belongs in the script
        expect((await lines(page)).join("\n")).toBe("[[start]]:\nGo [[nowhere]], or look at the [sky].\n\n[sky]:\n\n[[nowhere]]:\n\n[[end]]:\n@end\nDone. [[start]]");
    });
});

test("a story opens with its map as it was left", async ({ page }) => {
    await openStory(page);
    await page.reload();
    await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute("aria-pressed", "true");
    // Whichever sections it has: the text typed just before reloading may not have been saved
    await expect(page.locator("[data-node]").first()).toBeVisible();
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await page.reload();
    await expect(editor(page)).toBeVisible();
    await expect(map(page)).toHaveCount(0);
});

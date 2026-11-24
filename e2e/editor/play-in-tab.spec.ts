import { test, expect, type Page } from "@playwright/test";

// Play in a new tab (#644): the published story is someone's JavaScript, so it plays on the
// player's domain (player/src/play.ts), from the player's dev server here, not in a tab of the
// editor's own, which would have the editor's origin and storage.

// The player dev server the editor sends Play in a new tab to (its VITE_PLAYER_URL, if set)
const PLAYER = process.env.VITE_PLAYER_URL ?? "http://localhost:5181";

const story = `@title Test

Hello from the story. Go [[on]].

[[on]]:
The next part.`;

const editor = (page: Page) => page.locator("#editor .cm-content:visible");

async function openStory(page: Page) {
    await page.goto("/");
    await page.getByText("New story").click();
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText(story);
    await expect(editor(page)).toContainText("The next part.");
}

test("the story plays on the player's domain, with no way back to the editor", async ({ page, context }) => {
    await openStory(page);
    await page.getByRole("button", { name: "Run options" }).click();
    const opened = context.waitForEvent("page");
    await page.getByRole("menuitem", { name: "Play in a new tab" }).click();
    const tab = await opened;
    await expect(tab.getByText("Hello from the story.")).toBeVisible();
    expect(await tab.evaluate(() => ({ origin: location.origin, opener: window.opener === null })))
        .toEqual({ origin: PLAYER, opener: true });

    // It plays, and a reload (as the story's Restart does) plays it again
    await tab.getByRole("link", { name: "on" }).click();
    await expect(tab.getByText("The next part.")).toBeVisible();
    await tab.reload();
    await expect(tab.getByText("Hello from the story.")).toBeVisible();
});

test("the play page on its own has no story", async ({ page }) => {
    await page.goto(`${PLAYER}/v7/play`);
    await expect(page.getByRole("heading", { name: "No story here" })).toBeVisible();
});

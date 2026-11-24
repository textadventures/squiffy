// The published story, as players see it: "Buttons, panels and settings"
import { test, expect, around, capture, openStory, reseed, run, settle } from "./lib.js";
import type { Page } from "@playwright/test";

// Plays the game show up to where Hank asks the contestant's name, in a tab of its own from the
// preview's Run options, Play in a new tab
async function playInTab(page: Page): Promise<Page> {
    await openStory(page, "examples/gameshow");
    await run(page);
    const [tab] = await Promise.all([
        page.context().waitForEvent("page"),
        page.getByRole("button", { name: "Run options" }).click().then(() =>
            page.getByRole("menuitem", { name: "Play in a new tab" }).click()),
    ]);
    await tab.waitForURL(/^blob:/);
    await tab.setViewportSize(page.viewportSize()!);
    const story = tab.locator("body");
    await story.getByRole("link", { name: "Take your seat" }).click();
    const name = tab.getByPlaceholder("Your name");
    await expect(name).toBeVisible({ timeout: 30_000 });
    await settle(tab);
    await name.fill("Priya");
    await reseed(tab);
    await name.press("Enter");
    await expect(tab.getByText("Welcome, Priya!").first()).toBeVisible({ timeout: 30_000 });
    return tab;
}

test("the published game show, with its side panel and buttons", async ({ page }) => {
    const tab = await playInTab(page);
    // The game show's studio is dark whatever the player's system says, so there's one version
    await capture(tab, "player", { themes: false });
});

test("the player's settings", async ({ page }) => {
    const tab = await playInTab(page);
    await tab.getByRole("button", { name: "Settings" }).click();
    const settings = tab.getByRole("dialog");
    await expect(settings).toBeVisible();
    await capture(tab, "player-settings", { clip: await around(settings, 24), themes: false });
});

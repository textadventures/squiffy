// The published story, as players see it: "Buttons, panels and settings"
import { test, expect, around, capture, choose, openStory, playInNewTab, reseed, run, settle } from "./lib.js";
import type { Page } from "@playwright/test";

// Plays the published game show up to where Hank asks the contestant's name
async function playInTab(page: Page): Promise<Page> {
    await openStory(page, "examples/gameshow");
    await run(page);
    const tab = await playInNewTab(page);
    await choose(tab, "Take your seat");
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

test("the published Coffee Shop Confessions, with its order pad", async ({ page }) => {
    await openStory(page, "examples/coffeeshop");
    await run(page);
    const tab = await playInNewTab(page);
    const name = tab.getByPlaceholder("Your name");
    await expect(name).toBeVisible();
    await name.fill("Priya");
    await reseed(tab);
    await name.press("Enter");
    await choose(tab, "The man by the window");
    await expect(tab.getByText("black coffee, no room").first()).toBeVisible();
    await capture(tab, "player-coffeeshop");
});

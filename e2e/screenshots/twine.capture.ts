// Opening a Twine story in the editor: "Converting from Twine". The story is a small Harlowe one,
// in stories/twine/the-lighthouse.twee, with where its passages are on Twine's map.
import { test, expect, around, capture, dialog, repoRoot } from "./lib.js";
import { join } from "node:path";
import type { Page } from "@playwright/test";

async function chooseTwineFile(page: Page) {
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles(join(repoRoot, "e2e/screenshots/stories/twine/the-lighthouse.twee"));
    await expect(dialog(page)).toBeVisible();
}

test("the editor asks before converting a Twine story", async ({ page }) => {
    await chooseTwineFile(page);
    await capture(page, "twine-convert", { clip: await around(dialog(page)) });
});

test("the converted story, on the map laid out as it was in Twine", async ({ page }) => {
    await chooseTwineFile(page);
    await dialog(page).getByRole("button", { name: /Convert/ }).click();
    await page.waitForURL(/\/edit\?/);
    await expect(page.locator("[data-node]").first()).toBeVisible();
    // The message saying what couldn't be converted goes after a while, so it's closed
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    await capture(page, "twine-map");
});

// Opening a Quest gamebook in the editor: "Converting a Quest gamebook". The gamebook is a small
// one, in stories/quest/the-dragons-hoard.aslx, with a page script, text that depends on a flag,
// and one thing the converter notes in quest-import.txt.
import { test, expect, around, capture, dialog, goToLine, repoRoot, setView } from "./lib.js";
import { join } from "node:path";
import type { Page } from "@playwright/test";

async function chooseQuestFile(page: Page) {
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles(join(repoRoot, "e2e/screenshots/stories/quest/the-dragons-hoard.aslx"));
    await expect(dialog(page)).toBeVisible();
}

test("the editor asks before converting a Quest gamebook", async ({ page }) => {
    await chooseQuestFile(page);
    await capture(page, "quest-convert", { clip: await around(dialog(page)) });
});

test("the converted gamebook, beside its map", async ({ page }) => {
    await chooseQuestFile(page);
    await dialog(page).getByRole("button", { name: /Convert/ }).click();
    await page.waitForURL(/\/edit\?/);
    // The message saying what couldn't be converted goes after a while, so it's closed
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    await setView(page, "Code + Map");
    await goToLine(page, "[[The Lair]]:");
    await capture(page, "quest-converted");
});

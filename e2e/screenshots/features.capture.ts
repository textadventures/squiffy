// Editor features: "Snippets", "Stories in several files", "The story map", "Publishing your story",
// "The project file" and "Using the editor"
import { test, expect, around, capture, dialog, menu, openStory, setView } from "./lib.js";
import type { Locator, Page } from "@playwright/test";

// A rectangle around several elements, such as a button and the menu it opened
async function aroundAll(locators: Locator[], padding = 16) {
    const boxes = await Promise.all(locators.map(l => around(l, padding)));
    const x = Math.max(0, Math.min(...boxes.map(b => b.x))), y = Math.max(0, Math.min(...boxes.map(b => b.y)));
    return {
        x, y,
        width: Math.max(...boxes.map(b => b.x + b.width)) - x,
        height: Math.max(...boxes.map(b => b.y + b.height)) - y,
    };
}

const openMenu = (page: Page) => page.getByRole("menu").last();

test("the Add menu, with the snippets", async ({ page }) => {
    await openStory(page, "e2e/screenshots/stories/cave");
    await setView(page, "Code");
    const add = page.getByRole("button", { name: /^Add/ }).first();
    await add.click();
    await expect(openMenu(page)).toBeVisible();
    await capture(page, "snippets-menu", { clip: await aroundAll([add, openMenu(page)], 24) });
});

test("the files list's + menu", async ({ page }) => {
    await openStory(page, "examples/coffeeshop");
    const add = page.getByRole("button", { name: "New file" });
    await add.click();
    await expect(openMenu(page)).toBeVisible();
    await capture(page, "files-new", { clip: await aroundAll([page.getByText("Files", { exact: true }), openMenu(page)], 24) });
});

test("a stylesheet left out of the story", async ({ page }) => {
    await openStory(page, "examples/coffeeshop");
    await page.getByRole("button", { name: "More actions for daily-grind.css" }).click();
    await page.getByRole("menuitem", { name: "Exclude from story" }).click();
    // Its menu again, which now puts it back
    await page.getByRole("button", { name: "More actions for daily-grind.css" }).click();
    await expect(page.getByRole("menuitem", { name: "Include in story" })).toBeVisible();
    await capture(page, "files-excluded", { clip: await aroundAll([page.getByText("Files", { exact: true }), page.getByRole("button", { name: /^squiffy\.json/ }).first(), openMenu(page)], 24) });
});

test("writing a section beside the full-screen map", async ({ page }) => {
    await openStory(page, "e2e/screenshots/stories/cave");
    await setView(page, "Map");
    await page.locator('[data-node="section:right tunnel"]').click();
    await page.keyboard.press("Enter");
    await expect(page.locator("#editor header h2")).toHaveText("right tunnel");
    await capture(page, "story-map-card");
});

test("sharing a story as a link", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await openStory(page, "e2e/screenshots/stories/cave");
    await menu(page, "File", "Publish…");
    await dialog(page).getByRole("radio", { name: /A link/ }).check();
    await dialog(page).getByRole("button", { name: "Publish", exact: true }).click();
    await expect(dialog(page).getByText("Share a link")).toBeVisible();
    await capture(page, "publish-link", { clip: await around(dialog(page)) });
});

test("Story details", async ({ page }) => {
    await openStory(page, "examples/gameshow");
    await menu(page, "File", "Publish…");
    await dialog(page).getByRole("button", { name: "Edit details" }).or(dialog(page).getByRole("link", { name: "Edit details" })).click();
    await expect(dialog(page).getByText("Story details").first()).toBeVisible();
    await capture(page, "story-details", { clip: await around(dialog(page)) });
});

test("the editor's Settings", async ({ page }) => {
    await openStory(page, "examples/gameshow");
    await menu(page, "More", "Settings");
    await expect(dialog(page)).toBeVisible();
    await capture(page, "editor-settings", { clip: await around(dialog(page)) });
});

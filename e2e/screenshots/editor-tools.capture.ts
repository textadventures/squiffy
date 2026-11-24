// The editor's home page, problems, Start at menu and dialogs: "Using the editor", "Testing your
// story", "Publishing your story", "Images, sound and other files" and "Styling"
import { test, expect, around, capture, dialog, menu, openStory, run, setView } from "./lib.js";

test("the home page, with a story kept in the browser", async ({ page }) => {
    // The list says when each story was last opened, and is in that order
    await page.clock.setFixedTime(new Date("2026-11-24T10:15:00Z"));
    await openStory(page, "e2e/screenshots/stories/cave");
    await page.clock.setFixedTime(new Date("2026-11-24T10:30:00Z"));
    await openStory(page, "examples/gameshow");
    await page.getByRole("button", { name: "Back to home" }).click();
    await expect(page.getByRole("button", { name: /^gameshow\.squiffy/ })).toBeVisible();
    // Down to the bottom of the list, as the rest of the page is empty
    const list = await around(page.getByRole("region", { name: "In this browser" }), 0);
    await capture(page, "editor-home", { clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: list.y + list.height + 48 } });
});

test("the problems list, and a quick fix", async ({ page }) => {
    await openStory(page, "e2e/screenshots/stories/cave");
    await setView(page, "Code");
    await page.getByRole("button", { name: /^Problems:/ }).click();
    await expect(page.getByText("which doesn't exist").first()).toBeVisible();
    await capture(page, "editor-problems");
});

test("the preview's Start at menu", async ({ page }) => {
    await openStory(page, "examples/gameshow");
    await setView(page, "Code");
    await run(page);
    await page.getByRole("button", { name: "Start at a section" }).click();
    // The top of the preview, down to the bottom of the menu
    const preview = await around(page.locator("section, aside, div").filter({ has: page.getByText("Preview", { exact: true }) }).last(), 0);
    const list = await around(page.getByPlaceholder("Find a section").locator("xpath=.."), 0);
    await capture(page, "start-at", { clip: { ...preview, height: list.y + list.height + 24 - preview.y } });
});

test("the Publish dialog", async ({ page }) => {
    await openStory(page, "examples/gameshow");
    await menu(page, "File", "Publish…");
    await expect(dialog(page)).toBeVisible();
    await capture(page, "publish", { clip: await around(dialog(page)) });
});

test("Images and other files", async ({ page }) => {
    await openStory(page, "examples/gameshow");
    await page.getByRole("button", { name: "Images and other files" }).click();
    await expect(dialog(page)).toBeVisible();
    await capture(page, "files", { clip: await around(dialog(page)) });
});

test("Fonts", async ({ page }) => {
    await openStory(page, "examples/gameshow");
    await page.getByRole("button", { name: "Fonts" }).click();
    await expect(dialog(page)).toBeVisible();
    await capture(page, "fonts", { clip: await around(dialog(page)) });
});

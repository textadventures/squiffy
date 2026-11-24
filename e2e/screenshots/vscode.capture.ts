// The VS Code extension, in VS Code for the web (vscode-test-web, which the config starts on the
// game show): the docs' "VS Code" page
import type { Page } from "@playwright/test";
import { test, expect, capture, settle } from "./lib.js";

const VSCODE = "http://localhost:3123";

// Runs a command from the command palette
async function command(page: Page, name: string) {
    await page.keyboard.press("F1");
    const input = page.locator(".quick-input-widget input");
    await input.fill(`>${name}`);
    await expect(page.locator(".quick-input-list .monaco-list-row").first()).toContainText(name);
    await page.keyboard.press("Enter");
}

// VS Code has its own theme, rather than following the system's
const setTheme = (page: Page) => async (dark: boolean) => {
    const isDark = await page.locator(".monaco-workbench.vs-dark").count() > 0;
    if (isDark !== dark) {
        await command(page, "Preferences: Toggle between Light/Dark Themes");
        await expect(page.locator(".monaco-workbench.vs-dark")).toHaveCount(dark ? 1 : 0);
    }
};

// Everything below the title bar, which says "[Extension Development Host]"
async function belowTitleBar(page: Page) {
    const title = (await page.locator(".part.titlebar").boundingBox())!;
    const viewport = page.viewportSize()!;
    const top = title.y + title.height;
    return { x: 0, y: top, width: viewport.width, height: viewport.height - top };
}

test("the game show, with the preview beside it", async ({ page }) => {
    await page.goto(VSCODE);
    await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("treeitem", { name: "gameshow.squiffy" }).click();
    await expect(page.locator(".monaco-editor .view-lines")).toContainText("@title");
    // The Outline lists the story's sections
    await page.getByRole("button", { name: "Outline Section" }).click();
    // Once the language server has started, which can take a while
    await expect(page.getByRole("treeitem", { name: /scoreboard/ })).toBeVisible({ timeout: 60_000 });
    await command(page, "Squiffy: Show Preview");
    const preview = page.frameLocator("iframe.webview").frameLocator("iframe");
    await expect(preview.getByRole("link", { name: "Take your seat" })).toBeVisible({ timeout: 30_000 });
    // The splitters between the views show dots for a moment when the mouse goes over one
    await page.addStyleTag({ content: ".monaco-sash { visibility: hidden !important; }" });
    await capture(page, "vscode", { setTheme: setTheme(page), clip: await belowTitleBar(page) });
});

test("the story map beside the script", async ({ page }) => {
    await page.goto(VSCODE);
    await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("treeitem", { name: "gameshow.squiffy" }).click();
    await expect(page.locator(".monaco-editor .view-lines")).toContainText("@title");
    // The cursor in a section in the middle of the story, which the map highlights
    await page.keyboard.press("F1");
    await page.locator(".quick-input-widget input").fill(":116");
    await page.keyboard.press("Enter");
    await command(page, "Squiffy: Show Story Map");
    const map = page.frameLocator("iframe.webview").frameLocator("iframe");
    // Once the language server has read the story, the cursor's section is shown in the middle
    await expect(map.locator(".gm-node.current")).toBeVisible({ timeout: 60_000 });
    await settle(page);
    // Room for the map, and close enough to read: the whole game show is too small to
    await command(page, "View: Close Primary Side Bar");
    for (let i = 0; i < 5; i++) await map.getByRole("button", { name: "Zoom in" }).click();
    await settle(page);
    await page.addStyleTag({ content: ".monaco-sash { visibility: hidden !important; }" });
    await capture(page, "vscode-story-map", { setTheme: setTheme(page), clip: await belowTitleBar(page) });
});

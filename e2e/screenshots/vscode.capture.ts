// The VS Code extension, in VS Code for the web (vscode-test-web, which the config starts on the
// game show): the docs' "VS Code" page
import type { Page } from "@playwright/test";
import { test, expect, capture } from "./lib.js";

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
    await command(page, "Squiffy: Show Preview");
    const preview = page.frameLocator("iframe.webview").frameLocator("iframe");
    await expect(preview.getByRole("link", { name: "Take your seat" })).toBeVisible({ timeout: 30_000 });
    await capture(page, "vscode", { setTheme: setTheme(page), clip: await belowTitleBar(page) });
});

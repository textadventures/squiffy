// The VS Code extension, in VS Code for the web (vscode-test-web, which the config starts on the
// game show): the docs' "VS Code" page
import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test, expect, capture, settle, repoRoot } from "./lib.js";

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
    // Selected, for its details along the bottom of the map
    await map.locator(".gm-node.current").click();
    await expect(map.getByRole("region", { name: "Selected section" })).toBeVisible();
    await settle(page);
    await page.addStyleTag({ content: ".monaco-sash { visibility: hidden !important; }" });
    await capture(page, "vscode-story-map", { setTheme: setTheme(page), clip: await belowTitleBar(page) });
});

// The pictures in the extension's getting-started walkthrough, on VS Code's Welcome page
// (contributes.walkthroughs in vscode/package.json), which go in the extension, not the docs.
// A smaller window, as the Welcome page shows them in its right-hand half.
test.describe("the getting-started walkthrough", () => {
    // At 1.5 times the pixels, rather than twice, as they're in the extension's download
    test.use({ viewport: { width: 1100, height: 680 }, deviceScaleFactor: 1.5 });
    const dir = "vscode/media/walkthrough";

    // The game show's main file, once the language server has read it
    async function openStory(page: Page) {
        await page.goto(VSCODE);
        await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
        await page.getByRole("treeitem", { name: "gameshow.squiffy" }).click();
        await expect(page.locator(".monaco-editor .view-lines")).toContainText("@title");
        await expect(page.locator(".codelens-decoration", { hasText: "Preview from here" }).first()).toBeAttached({ timeout: 60_000 });
    }

    async function goToLine(page: Page, line: number) {
        await page.keyboard.press("F1");
        await page.locator(".quick-input-widget input").fill(`:${line}`);
        await page.keyboard.press("Enter");
        await expect(page.locator(".quick-input-widget")).toBeHidden();
    }

    // reopen puts back what switching the theme closes, such as the completion list
    async function shoot(page: Page, name: string, reopen?: () => Promise<void>) {
        await page.addStyleTag({ content: ".monaco-sash { visibility: hidden !important; }" });
        const switchTheme = async (dark: boolean) => {
            await setTheme(page)(dark);
            await reopen?.();
        };
        await capture(page, name, { setTheme: switchTheme, clip: await belowTitleBar(page), dir });
        // Smaller, if pngquant is installed (brew install pngquant), as they're in the download
        for (const file of [`${name}.png`, `${name}-dark.png`]) {
            try {
                execFileSync("pngquant", ["--quality", "70-90", "--speed", "1", "--force", "--ext", ".png", join(repoRoot, dir, file)]);
            }
            catch {
                // Not installed: they're kept as they are
            }
        }
    }

    test("a story, with its sections in the Squiffy sidebar", async ({ page }) => {
        await openStory(page);
        await command(page, "Squiffy: Focus on Sections View");
        await expect(page.locator(".sidebar").getByRole("treeitem", { name: /intro/ })).toBeVisible({ timeout: 30_000 });
        await goToLine(page, 56);
        await shoot(page, "story");
    });

    test("the preview", async ({ page }) => {
        await openStory(page);
        await command(page, "View: Close Primary Side Bar");
        await goToLine(page, 42);
        await command(page, "Squiffy: Show Preview");
        const preview = page.frameLocator("iframe.webview").frameLocator("iframe");
        await expect(preview.getByRole("link", { name: "Take your seat" })).toBeVisible({ timeout: 30_000 });
        await shoot(page, "preview");
    });

    test("typing a link, with the sections to choose from", async ({ page }) => {
        await openStory(page);
        await command(page, "View: Close Primary Side Bar");
        await goToLine(page, 54);
        await page.keyboard.press("End");
        await page.keyboard.type("\n\nOr [[");
        const suggestions = page.locator(".suggest-widget .monaco-list-row").first();
        await expect(suggestions).toBeVisible({ timeout: 30_000 });
        await shoot(page, "link", async () => {
            if (await suggestions.isVisible()) return;
            await page.keyboard.press("Control+Space");
            await expect(suggestions).toBeVisible();
        });
    });

    test("Preview from here, above a section", async ({ page }) => {
        await openStory(page);
        await command(page, "View: Close Primary Side Bar");
        // Scrolled so that "play the round" is near the top
        await goToLine(page, 140);
        await goToLine(page, 116);
        await shoot(page, "preview-from-here");
    });

    test("the story map", async ({ page }) => {
        await openStory(page);
        await command(page, "View: Close Primary Side Bar");
        await goToLine(page, 116);
        await command(page, "Squiffy: Show Story Map");
        const map = page.frameLocator("iframe.webview").frameLocator("iframe");
        await expect(map.locator(".gm-node.current")).toBeVisible({ timeout: 60_000 });
        await settle(page);
        for (let i = 0; i < 4; i++) await map.getByRole("button", { name: "Zoom in" }).click();
        await settle(page);
        await shoot(page, "map");
    });

    test("Export's choices", async ({ page }) => {
        await openStory(page);
        await command(page, "View: Close Primary Side Bar");
        await command(page, "Squiffy: Export");
        await expect(page.locator(".quick-input-list")).toContainText("As a single HTML file");
        await shoot(page, "export");
    });
});

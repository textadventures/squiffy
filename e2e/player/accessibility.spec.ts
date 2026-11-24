import { test, expect, type Page } from "@playwright/test";
import { checkAccessibility } from "../axe.ts";
import { encodeStory } from "../../player/src/link.ts";

// The player (player/, squiffystories.com), from its dev server: axe's automated checks (WCAG 2.2
// A and AA) of the page and of the story's frame, which is where its bar is drawn, and what a
// screen reader and the keyboard get from it (#640)

const story = `@title The Cave

[[start]]:
Go to the [[cave]] or look at the [sky].

[sky]:
Blue.

[[cave]]:
It's dark.
@end`;

const link = (files: Record<string, string>) => `/v7/#story=${encodeStory({ files })}`;

const check = (page: Page) => checkAccessibility(page);

for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`${colorScheme} theme`, () => {
        test.use({ colorScheme });

        test("a story", async ({ page }) => {
            await page.goto(link({ "story.squiffy": story }));
            await expect(page.frameLocator("#story").getByRole("paragraph").filter({ hasText: "Go to the" })).toBeVisible();
            await check(page);
        });

        test("a link with no story", async ({ page }) => {
            await page.goto("/v7/");
            await expect(page.getByRole("heading", { level: 1, name: "No story here" })).toBeVisible();
            await check(page);
        });

        test("a story with a problem", async ({ page }) => {
            await page.goto(link({ "story.squiffy": "[[start]]:\n{{#if}}" }));
            await expect(page.getByRole("heading", { level: 1, name: "This story has a problem" })).toBeVisible();
            await expect(page.getByRole("link", { name: "Open in editor" })).toBeVisible();
            await check(page);
        });
    });
}

test("the story's frame is named for its title", async ({ page }) => {
    await page.goto(link({ "story.squiffy": story }));
    await expect(page.locator("#story")).toHaveAttribute("title", "The Cave");
    await expect(page).toHaveTitle("The Cave");
});

test("Tab goes through the story's bar, then its links", async ({ page }) => {
    await page.goto(link({ "story.squiffy": story }));
    const frame = page.frameLocator("#story");
    await expect(frame.getByRole("paragraph").filter({ hasText: "Go to the" })).toBeVisible();
    const focused: string[] = [];
    for (let i = 0; i < 5; i++) {
        await page.keyboard.press("Tab");
        focused.push(await frame.locator(":focus").evaluate(e => e.getAttribute("aria-label") ?? e.textContent ?? ""));
    }
    // Back is disabled, as there's nowhere to go back to
    expect(focused).toEqual(["Restart", "Switch to dark mode", "Open your own copy of this story in the Squiffy editor", "cave", "sky"]);

    // A link moves the focus to what it shows, for a screen reader to read
    await page.keyboard.press("Enter");
    await expect(frame.locator(":focus")).toHaveText("Blue.");
});

test("the opening is read out once, and not left on the page to be read again", async ({ page }) => {
    await page.goto(link({ "story.squiffy": story }));
    const announcer = page.frameLocator("#story").locator(".squiffy-preview-announcer");
    await expect(announcer).toHaveText("Go to the cave or look at the sky.");
    await expect(announcer).toHaveText("", { timeout: 5000 });
});

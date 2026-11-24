import { test, expect, type Page } from "@playwright/test";
import { checkAccessibility } from "./axe.ts";

// axe's automated checks (WCAG 2.2 A and AA) of the example stories in examples/, as they're
// published, light and dark (#641): at the start, after a few links, and with each of the page's
// panels and dialogs open. The test server builds them as the CLI does, at /examples/<name>/.
// They're the authors' stories as much as ours, so this is mostly a check of what the runtime and
// the published page give every story: the header, links, panels and dialogs.

const check = (page: Page) => checkAccessibility(page);

const link = (page: Page, name: string) => page.locator("#squiffy").getByRole("link", { name, exact: true }).last();

// The story ignores links while it's changing sections, so wait for that, and for its animations
// that run straight away (not looping or link-triggered), which remove the squiffy-animate class
// when they finish, as in back.spec.ts
async function settled(page: Page) {
    await expect(page.locator(".squiffy-animate:not([data-loop]):not([data-trigger]):not(.squiffy-continue)")).toHaveCount(0, { timeout: 15_000 });
}

// The dialog a header button opens, checked, then closed again with Escape
async function checkDialog(page: Page, button: string) {
    await page.locator(button).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await check(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
}

for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`${colorScheme} theme`, () => {
        test.use({ colorScheme });

        test.describe("Coffee Shop Confessions", () => {
            test.beforeEach(async ({ page }) => {
                await page.goto("/examples/coffeeshop/");
                await expect(page.getByText("The bell above the door jingles")).toBeVisible();
            });

            test("the start, with its text box and side panel", async ({ page }) => {
                await expect(page.getByText("Nothing yet.")).toBeVisible();
                await check(page);
            });

            test("after a few links", async ({ page }) => {
                await page.getByPlaceholder("Your name").fill("Jo");
                await link(page, "Tie on your apron").click();
                await settled(page);
                await expect(page.getByRole("heading", { name: "Monday, 7am" })).toBeVisible();
                await link(page, "espresso machine").click();
                await expect(page.getByText("a walrus in a tumble dryer")).toBeVisible();
                await link(page, "The man by the window").click();
                await expect(page.getByText("black coffee, no room").first()).toBeVisible();
                await check(page);
            });

            test("the saved games dialog", async ({ page }) => {
                await checkDialog(page, "#squiffy-saves-button");
            });
        });

        test.describe("The Wheel of Dubious Fortune", () => {
            test.beforeEach(async ({ page }) => {
                await page.goto("/examples/gameshow/");
                await expect(page.getByText("The studio is dark.")).toBeVisible();
            });

            test("the start, with its side panel", async ({ page }) => {
                await check(page);
            });

            test("after a few links, with animations and a text box", async ({ page }) => {
                await link(page, "Take your seat").click();
                await settled(page);
                await check(page);
                const name = page.getByPlaceholder("Your name");
                await name.fill("Priya");
                await name.press("Enter");
                // A {{#animate "continue"}}, which holds back the rest of the section until it's
                // clicked
                await page.locator(".squiffy-continue").click();
                await settled(page);
                await link(page, "Spin the wheel!").click();
                await expect(link(page, "Let's play!")).toBeVisible({ timeout: 15_000 });
                await settled(page);
                await check(page);
            });

            for (const panel of ["Prizes", "How to play"]) {
                test(`the ${panel} panel`, async ({ page }) => {
                    await page.locator("#squiffy-header").getByRole("button", { name: panel }).click();
                    await expect(page.getByRole("dialog")).toBeVisible();
                    await check(page);
                });
            }

            test("the saved games dialog", async ({ page }) => {
                await checkDialog(page, "#squiffy-saves-button");
            });

            test("the settings dialog", async ({ page }) => {
                await checkDialog(page, "#squiffy-settings-button");
            });
        });
    });
}

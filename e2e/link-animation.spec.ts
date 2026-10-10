import { test, expect } from "@playwright/test";

const linkSelector = ".squiffy-output-section a.squiffy-link";

// While the typewriter runs, anime.js splits the link text into a span per character.
// Once it finishes, the original link markup (with no spans) is restored.
async function waitForAnimationComplete(page) {
  await expect(page.locator(`${linkSelector} span`)).toHaveCount(0);
}

test.describe("Link-triggered animation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/link-animation/");
    await page.waitForSelector(linkSelector);
  });

  test("link stays disabled after the animation finishes", async ({ page }) => {
    const link = page.locator(linkSelector);
    await link.click();
    await waitForAnimationComplete(page);

    await expect(page.locator("text=Link passage shown.")).toHaveCount(1);
    await expect(link).toHaveClass(/\bdisabled\b/);
    await expect(link).toHaveAttribute("tabindex", "-1");

    // Clicking again should not show the passage a second time. Disabled links have
    // pointer-events: none, so dispatch the click directly.
    await link.dispatchEvent("click");
    await page.waitForTimeout(500);
    await expect(page.locator("text=Link passage shown.")).toHaveCount(1);
  });

  test("link is re-enabled and animates again after going back", async ({ page }) => {
    const link = page.locator(linkSelector);
    await link.click();
    await waitForAnimationComplete(page);
    await expect(page.locator("text=Link passage shown.")).toHaveCount(1);

    await page.evaluate(() => (window as any).squiffyApi.goBack());

    await expect(page.locator("text=Link passage shown.")).toHaveCount(0);
    await expect(link).not.toHaveClass(/\bdisabled\b/);
    await expect(link).not.toHaveAttribute("tabindex", /.*/);

    // Clicking again runs the animation (the link text gets split into characters)
    // and shows the passage once more
    await link.click();
    await expect(page.locator(`${linkSelector} span`).first()).toBeAttached();
    await waitForAnimationComplete(page);
    await expect(page.locator("text=Link passage shown.")).toHaveCount(1);
    await expect(link).toHaveClass(/\bdisabled\b/);
  });
});

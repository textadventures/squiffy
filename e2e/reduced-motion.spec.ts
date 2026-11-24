import { test, expect } from "@playwright/test";

// A player who has asked their system to reduce motion gets the text without the motion
test.describe("With reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("typewriter and toast fade in at once, and a slide is a fade", async ({ page }) => {
    const start = Date.now();
    await page.goto("/reduced-motion/");

    // Without reduced motion this is several seconds of typing
    const link = page.locator(".squiffy-output-section a.squiffy-link", { hasText: "Next" });
    await expect(link).toBeVisible();
    await expect(page.locator(".squiffy-output-section [data-char], .squiffy-output-section [data-word]")).toHaveCount(0);
    expect(Date.now() - start).toBeLessThan(4000);

    // The section still transitions, but as a fade, not a slide
    const animationName = await page.locator(".squiffy-output-section").first().evaluate(
      el => [el, ...el.querySelectorAll("*")].map(e => getComputedStyle(e).animationName).filter(n => n !== "none"));
    expect(animationName.every(n => n === "squiffy-transition-fade")).toBe(true);

    // The text effect stays still
    expect(await page.locator(".squiffy-style.sway").evaluate(el => getComputedStyle(el).animationName)).toBe("none");

    // and the links still work
    await link.click();
    await expect(page.locator("text=The end.")).toBeVisible();
  });
});

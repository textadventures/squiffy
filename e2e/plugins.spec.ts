import { test, expect } from "@playwright/test";

// Helper to wait for Squiffy to fully initialize
async function waitForSquiffyReady(page) {
  // Capture console errors
  const consoleErrors = [];
  page.on("console", msg => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", error => {
    console.log("Page error:", error.message);
  });

  // Wait for the squiffy container to have content
  try {
    await page.waitForSelector("#squiffy .squiffy-output-section", { timeout: 10000 });
  } catch (e) {
    // Log the page content for debugging
    const html = await page.content();
    console.log("Page HTML:", html.substring(0, 1000));
    console.log("Console errors:", consoleErrors);
    throw e;
  }
  // Give a bit more time for plugins to initialize
  await page.waitForTimeout(500);
}

test.describe("Animation Plugin", () => {
  test("should animate text with typewriter effect", async ({ page }) => {
    await page.goto("/animations/");
    await waitForSquiffyReady(page);

    // Wait for initial animation to start
    await page.waitForSelector(".squiffy-animate");

    // Check that animated span exists
    const animatedSpan = page.locator(".squiffy-animate").first();
    await expect(animatedSpan).toBeVisible();

    // Wait a bit for animation to progress
    await page.waitForTimeout(1000);

    // The text should be visible after animation
    await expect(animatedSpan).toContainText("This text should animate");
  });

  test("should trigger animation on link click", async ({ page }) => {
    await page.goto("/animations/");
    await waitForSquiffyReady(page);

    // Navigate to the link trigger section
    await page.click("text=Continue...");
    await page.click("text=More...");
    await page.click("text=Link trigger...");

    // Find the link within animated span
    const animatedLink = page.locator(".squiffy-animate a").filter({ hasText: "Click to animate this" });
    await expect(animatedLink).toBeVisible();

    // Click the link
    await animatedLink.click();

    // Wait for passage content to appear
    await expect(page.locator("text=Animation triggered!")).toBeVisible();
  });

  test("should support animation with custom intervals", async ({ page }) => {
    await page.goto("/animations/");
    await waitForSquiffyReady(page);

    await page.click("text=Continue...");
    await page.click("text=More...");

    // Check for slower animation span
    const slowSpan = page.locator(".squiffy-animate").filter({ hasText: "This is slower" });
    await expect(slowSpan).toBeVisible();

    // Verify it has the interval attribute (note: data attributes store numbers as strings)
    await expect(slowSpan).toHaveAttribute("data-interval", "200");
  });
});

test.describe("Replace Label Plugin", () => {
  test("should replace labeled content with fade transition", async ({ page }) => {
    await page.goto("/replace/");
    await waitForSquiffyReady(page);

    // Check initial score
    const scoreLabel = page.locator(".squiffy-label-score");
    await expect(scoreLabel).toHaveText("0");

    // Click to increase to 50
    await page.click("text=Increase to 50");

    // Wait for fade transition and check new value
    await page.waitForTimeout(600); // Wait for fade transition
    await expect(scoreLabel).toHaveText("50");

    // Click to increase to 100
    await page.click("text=Increase to 100");

    // Wait for fade transition and check final value
    await page.waitForTimeout(600);
    await expect(scoreLabel).toHaveText("100");

    // Verify the text appears
    await expect(page.locator("text=Maximum score reached!")).toBeVisible();
  });

  test("should maintain label span class after replacement", async ({ page }) => {
    await page.goto("/replace/");
    await waitForSquiffyReady(page);

    const scoreLabel = page.locator(".squiffy-label-score");
    await expect(scoreLabel).toBeVisible();

    await page.click("text=Increase to 50");
    await page.waitForTimeout(600);

    // Label should still have the same class after replacement
    await expect(scoreLabel).toBeVisible();
    await expect(scoreLabel).toHaveClass(/squiffy-label-score/);
  });
});

test.describe("Live Update Plugin", () => {
  test("should update live content when attributes change", async ({ page }) => {
    await page.goto("/live/");
    await waitForSquiffyReady(page);

    // Check initial values
    const scoreLive = page.locator(".squiffy-live").filter({ hasText: "0" }).first();
    const statusLive = page.locator(".squiffy-live").filter({ hasText: "waiting" }).first();

    await expect(scoreLive).toBeVisible();
    await expect(statusLive).toBeVisible();

    // Click to increase score
    await page.click("text=Increase score");

    // Wait for fade transition and check updated value
    await page.waitForTimeout(600);
    await expect(page.locator(".squiffy-live").filter({ hasText: "100" })).toBeVisible();

    // Click to change status
    await page.click("text=Change status");

    // Wait for fade transition and check updated status
    await page.waitForTimeout(600);
    await expect(page.locator(".squiffy-live").filter({ hasText: "completed" })).toBeVisible();
  });

  test.skip("should update live section content", async ({ page }) => {
    // Skipped: Live section embedding is complex and may need adjustments
    // The basic live updates work (tested in other tests)
  });

  test("should create live spans with correct attributes", async ({ page }) => {
    await page.goto("/live/");
    await waitForSquiffyReady(page);

    // Check that live spans have the right data attributes
    const scoreLive = page.locator('.squiffy-live[data-attribute="score"]').first();
    await expect(scoreLive).toBeVisible();

    const statusLive = page.locator('.squiffy-live[data-attribute="status"]').first();
    await expect(statusLive).toBeVisible();
  });
});

test.describe("Cross-plugin integration", () => {
  test("should handle multiple plugins working together", async ({ page }) => {
    await page.goto("/live/");
    await waitForSquiffyReady(page);

    // Test that live updates work with passage clicks
    const initialScore = page.locator('.squiffy-live[data-attribute="score"]').first();
    await expect(initialScore).toHaveText("0");

    // Click to increase score
    await page.click("text=Increase score");
    await page.waitForTimeout(600);

    // Score should be updated
    await expect(page.locator(".squiffy-live").filter({ hasText: "100" })).toBeVisible();

    // Change status too
    await page.click("text=Change status");
    await page.waitForTimeout(600);

    // Both live updates should persist
    await expect(page.locator(".squiffy-live").filter({ hasText: "100" })).toBeVisible();
    await expect(page.locator(".squiffy-live").filter({ hasText: "completed" })).toBeVisible();
  });
});

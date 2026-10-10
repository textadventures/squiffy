import { test, expect, Page } from "@playwright/test";

// The packaged story has no Back button (only the editor does), so we capture the API that
// squiffyRuntime.init() returns, and call goBack() on it directly.
async function openStory(page: Page) {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.addInitScript(() => {
    let runtime: any;
    Object.defineProperty(window, "squiffyRuntime", {
      configurable: true,
      get: () => runtime,
      set: value => {
        const init = value.init;
        value.init = async (options: any) => {
          const api = await init(options);
          (window as any).squiffyApi = api;
          return api;
        };
        runtime = value;
      },
    });
  });

  await page.goto("/back/");
  await page.waitForSelector("#squiffy .squiffy-output-section");
  await page.waitForFunction(() => (window as any).squiffyApi);
  return pageErrors;
}

const goBack = (page: Page) => page.evaluate(() => (window as any).squiffyApi.goBack());
const get = (page: Page, attribute: string) => page.evaluate(a => (window as any).squiffyApi.get(a), attribute);

// The last section's links are the only ones that can be clicked
const link = (page: Page, text: string) =>
  page.locator(".squiffy-output-section:last-child a.squiffy-link", { hasText: text });

// Animations that run straight away (not looping or link-triggered) remove the squiffy-animate class when they finish
const waitForAnimations = (page: Page) =>
  expect(page.locator(".squiffy-animate:not([data-loop]):not([data-trigger])")).toHaveCount(0, { timeout: 10000 });

test.describe("Back button with animations", () => {
  test("is ignored during an animation, then works once it finishes", async ({ page }) => {
    const pageErrors = await openStory(page);

    await link(page, "animated").click();
    await expect(page.locator(".squiffy-animate")).toHaveCount(1);

    // Mid-animation (it takes about 4 seconds): going back does nothing
    await page.waitForTimeout(500);
    await goBack(page);
    await expect(page.locator(".squiffy-output-section[data-section='animated']")).toHaveCount(1);
    expect(await get(page, "step")).toBe("animated");

    await waitForAnimations(page);
    await expect(page.locator("text=This sentence types itself out slowly.")).toBeVisible();

    // Now going back works, and the section can be visited again
    await goBack(page);
    await expect(page.locator(".squiffy-output-section[data-section='animated']")).toHaveCount(0);
    expect(await get(page, "step")).toBe("start");
    expect(await get(page, "_section")).toBe("start");

    await link(page, "animated").click();
    await waitForAnimations(page);
    await expect(page.locator("text=This sentence types itself out slowly.")).toBeVisible();
    expect(await get(page, "step")).toBe("animated");

    expect(pageErrors).toEqual([]);
  });

  test("restores a looping animation from before a cleared screen", async ({ page }) => {
    const pageErrors = await openStory(page);

    await link(page, "animated").click();
    await waitForAnimations(page);
    await link(page, "looping").click();
    const loopingText = page.locator(".squiffy-animate[data-loop]", { hasText: "Looping text." });
    await expect(loopingText).toBeVisible();

    await link(page, "cleared").click();
    await waitForAnimations(page);
    await expect(page.locator("text=Fresh screen.")).toBeVisible();
    await expect(loopingText).toBeHidden();

    await goBack(page);
    await expect(page.locator("text=Fresh screen.")).toHaveCount(0);
    await expect(loopingText).toBeVisible();
    expect(await get(page, "step")).toBe("looping");

    // The looping animation is still running: its opacity keeps changing
    const opacities = new Set<string>();
    for (let i = 0; i < 10; i++) {
      opacities.add(await loopingText.evaluate(el => getComputedStyle(el).opacity));
      await page.waitForTimeout(100);
    }
    expect(opacities.size).toBeGreaterThan(1);

    // And we can carry on going back
    await goBack(page);
    expect(await get(page, "step")).toBe("animated");
    await expect(link(page, "looping")).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("lets a link-triggered animation's passage be shown again after going back", async ({ page }) => {
    const pageErrors = await openStory(page);

    await link(page, "animated").click();
    await waitForAnimations(page);
    await link(page, "looping").click();

    await link(page, "Animate this link").click();

    // The passage waits for the link's animation. Going back during it does nothing.
    await page.waitForTimeout(300);
    await goBack(page);

    await expect(page.locator("text=Link passage shown.")).toBeVisible({ timeout: 10000 });
    await waitForAnimations(page);

    await goBack(page);
    await expect(page.locator("text=Link passage shown.")).toHaveCount(0);
    expect(await get(page, "_section")).toBe("looping");

    // The link works again, and shows the passage again
    await expect(link(page, "Animate this link")).not.toHaveClass(/disabled/);
    await link(page, "Animate this link").click();
    await expect(page.locator("text=Link passage shown.")).toBeVisible({ timeout: 10000 });

    expect(pageErrors).toEqual([]);
  });
});

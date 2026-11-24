import { test, expect, type Page } from "@playwright/test";

// {{#animate "continue"}} from the keyboard: it's a button that Tab reaches and Enter presses, and
// the text it holds back can't be reached until it's shown

// What Tab reaches, from the top of the page, in this many presses
async function tabOrder(page: Page, presses: number) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const reached: string[] = [];
    for (let i = 0; i < presses; i++) {
        await page.keyboard.press("Tab");
        reached.push(await page.evaluate(() => document.activeElement?.textContent?.trim() || document.activeElement?.getAttribute("aria-label") || ""));
    }
    return reached;
}

test("a continue is pressed with the keyboard, and Tab then goes on to what it showed", async ({ page }) => {
    await page.goto("/continue/");
    const cont = page.locator("#squiffy").getByRole("button", { name: "Go on" });
    await expect(cont).toBeVisible();

    // The link it holds back is out of the Tab order until it's shown
    const reached = await tabOrder(page, 10);
    expect(reached).toContain("Go on");
    expect(reached).not.toContain("next");

    await cont.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("After the pause.")).toBeVisible();
    await expect(page.locator(".squiffy-animate")).toHaveCount(0);

    // Only text now, and the focus is still on it, so Tab goes on to the link it showed
    await expect(page.locator("#squiffy").getByRole("button", { name: "Go on" })).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(page.locator("#squiffy").getByRole("link", { name: "next" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Done.")).toBeVisible();
});

test("a continue is pressed with Space", async ({ page }) => {
    await page.goto("/continue/");
    await page.locator("#squiffy").getByRole("button", { name: "Go on" }).focus();
    await page.keyboard.press(" ");
    await expect(page.getByText("After the pause.")).toBeVisible();
});

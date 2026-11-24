import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// axe's automated checks (WCAG 2.2 A and AA: contrast, names, roles...) on the editor's main
// views, light and dark (#639). They catch only some problems: the rest needs a screen reader and
// the keyboard.

const story = `@title Test

[[start]]:
Go to the [[cave]] or the [[hill]].

[[cave]]:
It's dark. Look at the [wall], or go to the [[hill]].

[wall]:
Damp.

[[empty]]:

[[hill]]:
@end
The end. [[nowhere]]
`;

const editor = (page: Page) => page.locator("#editor .cm-content:visible");

async function check(page: Page) {
    const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        // The story's own page, in the preview's sandboxed frame, is the author's, not the editor's
        .exclude("iframe")
        // Not yet: maximum-scale=1 stops iOS zooming in when the script (14px text) gets the
        // focus, but also stops pinch zoom on Android (#639)
        .disableRules(["meta-viewport"])
        .analyze();
    const found = results.violations.map(v => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map(n => `    ${n.target.join(" ")}: ${n.failureSummary?.split("\n").slice(1).join(" ")}`).join("\n")}`);
    expect(found, found.join("\n\n")).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`${colorScheme} theme`, () => {
        test.use({ colorScheme });

        test("home page", async ({ page }) => {
            await page.goto("/");
            await expect(page.getByText("New story")).toBeVisible();
            await check(page);
        });

        test("script, preview and problems", async ({ page }) => {
            await page.goto("/");
            await page.getByText("New story").click();
            await editor(page).click();
            await page.keyboard.press("ControlOrMeta+A");
            await page.keyboard.insertText(story.trimEnd());
            await expect(editor(page)).toContainText("[[nowhere]]");
            await page.keyboard.press("ControlOrMeta+Shift+M");
            await expect(page.getByRole("region", { name: "Problems" })).toBeVisible();
            await check(page);
        });

        for (const item of ["Keyboard shortcuts", "Settings", "About Squiffy", "Find in files"]) {
            test(item, async ({ page }) => {
                await page.goto("/");
                await page.getByText("New story").click();
                await expect(editor(page)).toBeVisible();
                await page.getByRole("button", { name: "More", exact: true }).click();
                await page.getByRole("menuitem", { name: item }).click();
                await expect(item == "Find in files" ? page.getByRole("searchbox").or(page.getByPlaceholder(/find/i)).first() : page.getByRole("dialog")).toBeVisible();
                await check(page);
            });
        }

        test("story map", async ({ page }) => {
            await page.goto("/");
            await page.getByText("New story").click();
            await editor(page).click();
            await page.keyboard.press("ControlOrMeta+A");
            await page.keyboard.insertText(story.trimEnd());
            await expect(editor(page)).toContainText("[[nowhere]]");
            await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Map", exact: true }).click();
            await expect(page.locator("[data-node]").first()).toBeVisible();
            await check(page);
        });
    });
}

// How many different places a new box is drawn in while the map makes room for it
async function placesOfNewBox(page: Page) {
    await page.goto("/");
    await page.getByText("New story").click();
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText(story.trimEnd());
    await expect(editor(page)).toContainText("[[nowhere]]");
    await page.getByRole("button", { name: "Code + Map", exact: true }).click();
    await expect(page.locator('[data-node="section:cave"]')).toBeVisible();
    await page.waitForTimeout(1000);
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText("\n\n[[new]]:\nGo to the [[cave]].");
    const node = page.locator('[data-node="section:new"]');
    await expect(node).toBeAttached();
    return node.evaluate(el => new Promise<number>(resolve => {
        const seen = new Set<string>();
        const started = performance.now();
        const sample = () => {
            seen.add((el as HTMLElement).style.transform);
            if (performance.now() - started < 1500) requestAnimationFrame(sample);
            else resolve(seen.size);
        };
        sample();
    }));
}

test("the map shows its boxes moving into place", async ({ page }) => {
    expect(await placesOfNewBox(page)).toBeGreaterThan(5);
});

test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("the map only shows where its boxes end up", async ({ page }) => {
        expect(await placesOfNewBox(page)).toBeLessThanOrEqual(2);
    });
});

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readdirSync } from "node:fs";

// The docs site (site/), from its dev server, as beta.squiffystory.com: axe's automated checks
// (WCAG 2.2 A and AA) of every page, light and dark, with its editable samples running, and what
// the keyboard gets from the samples (#640). Starlight's own components are checked too, as
// they're on every page.

const pages = ["", ...readdirSync(new URL("../../site/src/content/docs", import.meta.url))
    .filter(file => file.endsWith(".mdx") && file != "index.mdx")
    .map(file => file.replace(/\.mdx$/, ""))];

// Scrolls down the page, so every sample starts: a sample's story starts when its editor is first
// drawn, which is when it's scrolled into view
async function startSamples(page: Page) {
    // The first time the dev server sees some of the samples' modules, it reloads the page
    await page.waitForLoadState("networkidle");
    await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) {
            scrollTo(0, y);
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        scrollTo(0, 0);
    });
    // The samples with files compile in the page and start in a frame
    await page.waitForTimeout(1000);
}

// What axe reports that isn't a problem, or isn't ours to fix
function knownProblem(rule: string, html: string) {
    // A sample's editor scrolls, and axe doesn't count CodeMirror's text (contenteditable) as
    // something in it that can have the focus, but it is
    if (rule == "scrollable-region-focusable" && html.includes("cm-scroller")) return true;
    // Starlight's search button, which is named "Search", and shows "Search" and its shortcut
    // (Ctrl K). Its name starts with the word it shows, so a voice control user can say it.
    if (rule == "label-content-name-mismatch" && html.includes("data-open-modal")) return true;
    return false;
}

async function check(page: Page) {
    const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        // Astro's dev toolbar, which isn't on the published site
        .exclude("astro-dev-toolbar")
        .analyze();
    const violations = results.violations
        .map(v => ({ ...v, nodes: v.nodes.filter(n => !knownProblem(v.id, n.html)) }))
        .filter(v => v.nodes.length);
    const found = violations.map(v => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map(n => `    ${n.target.join(" ")}: ${n.failureSummary?.split("\n").slice(1).join(" ")}`).join("\n")}`);
    expect(found, found.join("\n\n")).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`${colorScheme} theme`, () => {
        // Reduced motion stops the samples' text effects that fade in and out (and the continue
        // indicator's pulse), which axe would otherwise catch at any point in their fade
        test.use({ colorScheme, reducedMotion: "reduce" });

        for (const path of pages) {
            test(`/${path}`, async ({ page }) => {
                await page.goto(path ? `/${path}/` : "/");
                await expect(page.locator("main h1").first()).toBeVisible();
                await startSamples(page);
                await check(page);
            });
        }
    });
}

test("a sample's editor and story have names", async ({ page }) => {
    await page.goto("/tutorial/");
    const sample = page.locator("squiffy-sample").nth(1);
    await sample.scrollIntoViewIfNeeded();
    await expect(sample.getByRole("textbox", { name: "Story script" })).toBeVisible();
    await expect(sample.getByRole("group", { name: "Story" }).getByRole("link").first()).toBeVisible();

    await page.goto("/multiple-files/");
    const project = page.locator("squiffy-sample.project").first();
    await project.scrollIntoViewIfNeeded();
    await expect(project.getByRole("textbox", { name: "story.squiffy" })).toBeVisible();
    await project.getByRole("tab", { name: "chapter2.squiffy" }).click();
    await expect(project.getByRole("textbox", { name: "chapter2.squiffy" })).toBeVisible();
});

test("Restart in a sample leaves the focus in its story, not at the top of the page", async ({ page }) => {
    await page.goto("/tutorial/");
    const sample = page.locator("squiffy-sample").nth(1);
    await sample.scrollIntoViewIfNeeded();
    const story = sample.getByRole("group", { name: "Story" });
    await story.getByRole("link").first().focus();
    await page.keyboard.press("Enter");
    const restart = sample.getByRole("button", { name: "Restart" });
    await expect(restart).toBeVisible();
    await restart.focus();
    await page.keyboard.press("Enter");
    // The button hides itself until a link is clicked again
    await expect(restart).toBeHidden();
    await expect(story).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(story.getByRole("link").first()).toBeFocused();
});

test("the example's files can be chosen and scrolled with the keyboard", async ({ page }) => {
    await page.goto("/featured-examples/");
    const files = page.locator("example-files");
    const last = files.getByRole("navigation", { name: "Files" }).getByRole("button").last();
    await last.focus();
    await page.keyboard.press("Enter");
    await expect(last).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Tab");
    const shown = files.locator("section.current");
    await expect(shown).toBeFocused();
});

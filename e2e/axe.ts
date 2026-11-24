import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// axe's automated accessibility checks, for every accessibility spec in e2e/ (#641): the editor,
// the player, the docs site and the published example stories.
//
// What fails: every violation of a WCAG 2.2 A or AA rule fails the test. axe's "best-practice"
// rules, which aren't WCAG requirements, aren't run, and nothing only warns: a warning nobody
// reads doesn't stop a regression. Something axe gets wrong, or that we've decided to live with,
// goes in `knownProblems` below, with why, so the exceptions are all in one place.
//
// axe catches only some problems. The specs also check what the keyboard and a screen reader get
// (where the focus goes, what things are called), and the rest needs trying by hand.

const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

interface KnownProblem {
    rule: string;
    // Whether a node axe reports is this problem, from its HTML
    matches: (html: string) => boolean;
    why: string;
}

const knownProblems: KnownProblem[] = [
    {
        rule: "meta-viewport",
        matches: html => html.includes("maximum-scale=1"),
        why: "The editor's maximum-scale=1 stops iOS zooming in when the script (14px text) gets the focus, but also stops pinch zoom on Android. Not fixed yet (#639).",
    },
    {
        rule: "scrollable-region-focusable",
        matches: html => html.includes("cm-scroller"),
        why: "A docs sample's editor scrolls, and axe doesn't count CodeMirror's text (contenteditable) as something in it that can have the focus, but it is.",
    },
    {
        rule: "label-content-name-mismatch",
        matches: html => html.includes("data-open-modal"),
        why: "Starlight's search button is named \"Search\" and shows \"Search\" and its shortcut (Ctrl K). Its name starts with the word it shows, so a voice control user can say it.",
    },
];

function isKnown(rule: string, html: string) {
    return knownProblems.some(p => p.rule == rule && p.matches(html));
}

export interface CheckOptions {
    // Parts of the page that aren't ours to check, such as a story in the editor's preview (the
    // author's) or Astro's dev toolbar (not on the published site)
    exclude?: string[];
}

// Waits for the page's CSS transitions and animations to end, apart from ones that never do, so
// axe doesn't measure the contrast of text that's still fading in, or of a page still changing
// colour. A JavaScript animation (anime.js) is the test's to wait for.
async function animationsFinished(page: Page) {
    await page.evaluate(() => Promise.all(document.getAnimations()
        .filter(a => a.effect?.getComputedTiming().iterations != Infinity)
        .map(a => a.finished.catch(() => undefined))));
}

// Runs axe over the page, including its frames, and fails with what it found
export async function checkAccessibility(page: Page, options: CheckOptions = {}) {
    await animationsFinished(page);
    let builder = new AxeBuilder({ page }).withTags(tags);
    for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
    const results = await builder.analyze();
    const found = results.violations
        .map(v => ({ ...v, nodes: v.nodes.filter(n => !isKnown(v.id, n.html)) }))
        .filter(v => v.nodes.length)
        .map(v => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map(n => `    ${n.target.join(" ")}: ${n.failureSummary?.split("\n").slice(1).join(" ")}`).join("\n")}`);
    expect(found, found.join("\n\n")).toEqual([]);
}

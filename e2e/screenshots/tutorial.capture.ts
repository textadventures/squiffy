// The tutorial's two parts: "Tutorial: your first story" and "Tutorial: make it your own". The
// first part's shots use its steps from site/src/tutorial/, typed into a new story as the reader does.
import { test, expect, capture, choose, editor, goToLine, newStory, openStory, playInNewTab, repoFile, run, setView } from "./lib.js";

const step = (name: string) => repoFile(`site/src/tutorial/${name}.squiffy`);

test("a new story", async ({ page }) => {
    await newStory(page);
    await setView(page, "Code");
    await run(page);
    await capture(page, "tutorial-new-story");
});

test("taking the lantern, and the attributes it sets", async ({ page }) => {
    await newStory(page, step("3-attributes"));
    await setView(page, "Code");
    const frame = await run(page);
    await choose(frame, "row towards the island");
    await choose(frame, "old hut");
    await choose(frame, "lantern");
    await page.getByRole("button", { name: /^Attributes \(/ }).click();
    await expect(page.locator("dt", { hasText: "has_lantern" })).toBeVisible();
    await goToLine(page, "[lantern]:");
    await capture(page, "tutorial-attributes");
});

test("endings the editor doesn't know are endings", async ({ page }) => {
    await newStory(page, step("4-conditions"));
    await setView(page, "Code");
    await run(page);
    // The underlined name in the middle of the script, so the tooltip has room below it
    const line = editor(page).locator(".cm-line", { hasText: "[[run back to the boat]]:" });
    await line.scrollIntoViewIfNeeded();
    await line.evaluate(el => el.scrollIntoView({ block: "center" }));
    // Hover over it, to show the warning and its quick fix
    await line.locator(".cm-lintRange-warning").first().hover();
    await expect(page.locator(".cm-tooltip").first()).toBeVisible();
    await capture(page, "tutorial-dead-ends");
});

test("the finished story on the map, with the way the player went in green", async ({ page }) => {
    await newStory(page, step("5-endings"));
    await setView(page, "Code + Map");
    const frame = await run(page);
    await choose(frame, "row towards the island");
    await choose(frame, "old hut");
    await choose(frame, "lantern");
    await choose(frame, "path");
    await choose(frame, "Go into the cave");
    await choose(frame, "take me home");
    await goToLine(page, "[[take me home]]:");
    await capture(page, "tutorial-map");
});

test("part 2: the published story in the dark cave, with the inventory beside it", async ({ page }) => {
    await openStory(page, "site/src/tutorial/part-2/4-panel", {
        "sea.mp3": "site/public/tutorial/sounds/sea.mp3",
        "snuffle.mp3": "site/public/tutorial/sounds/snuffle.mp3",
    });
    await run(page);
    // Published, as the side panel needs a wider page than the preview has
    const tab = await playInNewTab(page);
    for (const link of ["row towards the island", "old hut", "lantern", "path", "Go into the cave"]) await choose(tab, link);
    await expect(tab.locator("body.cave, body:has(.cave)").first()).toBeAttached();
    // The cave is dark whatever the player's system says, so there's one version
    await capture(tab, "tutorial-part-2", { themes: false });
});

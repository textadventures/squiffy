// The editor: the docs' home page, "Using the editor" and "The story map"
import { test, expect, capture, choose, goToLine, openStory, resizePane, run, setView, settle } from "./lib.js";

test("the editor, with the game show running in the preview", async ({ page }) => {
    await openStory(page, "examples/gameshow");
    await setView(page, "Code");
    const frame = await run(page);
    // Wide enough for the story's side panel
    await resizePane(page, "preview", -300);
    await choose(frame, "Take your seat");
    // Hank asks for the contestant's name, once the intro has animated in
    const name = frame.getByPlaceholder("Your name");
    await expect(name).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await name.fill("Priya");
    await goToLine(page, "[[intro]]:");
    await capture(page, "editor");
});

test("the story map, beside the script and the preview", async ({ page }) => {
    await openStory(page, "e2e/screenshots/stories/cave");
    await setView(page, "Code + Map");
    const frame = await run(page);
    await choose(frame, "Go in");
    await choose(frame, "right");
    await goToLine(page, "[[right tunnel]]:");
    await capture(page, "story-map");
});

import { test, expect } from "@playwright/test";
import { encodeStory } from "../../player/src/link.ts";

// {{youtube}} in a story shared as a link: the story's frame is sandboxed, so YouTube's player
// can't play in it, and the video is its picture, which opens it on YouTube in a new tab

const story = `[[start]]:
The film begins.

{{youtube "https://youtu.be/aqz-KE-bpKQ?t=90" title="Big Buck Bunny"}}`;

// A picture, so the test doesn't need YouTube
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("a YouTube video is its picture, which opens it on YouTube in a new tab", async ({ page, context }) => {
    await context.route("https://i.ytimg.com/**", route => route.fulfill({ contentType: "image/png", body: png }));
    await context.route("https://www.youtube.com/**", route => route.fulfill({ contentType: "text/html", body: "<title>YouTube</title>" }));

    await page.goto(`/v7/#story=${encodeStory({ files: { "story.squiffy": story } })}`);
    const frame = page.frameLocator("#story");
    const video = frame.getByRole("link", { name: "Big Buck Bunny Watch on YouTube" });
    await expect(video).toBeVisible();
    await expect(frame.locator("iframe")).toHaveCount(0);
    const picture = video.locator("img");
    await expect(picture).toHaveAttribute("src", "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg");
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    // 16:9, as the player would be
    const box = (await video.boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(16 / 9, 1);

    const [popup] = await Promise.all([page.waitForEvent("popup"), video.click()]);
    await popup.waitForLoadState();
    expect(popup.url()).toBe("https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=90s");
    // The story's tab stays where it was
    expect(page.url()).toContain("/v7/#story=");
    await expect(frame.getByText("The film begins.", { exact: true })).toBeVisible();
});

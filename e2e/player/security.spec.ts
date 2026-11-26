import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect, type Page } from "@playwright/test";
import { encodeStory } from "../../player/src/link.ts";

// The player (player/, squiffystories.com), from its dev server: anyone can make a link to a story
// with any JavaScript in it, so a story mustn't be able to pass itself off as another site, such
// as a sign-in page, under squiffystories.com's address. The story's frame is sandboxed, so it
// can't navigate the reader's tab, and the page's Content-Security-Policy (player/vite.config.ts)
// stops anything else being loaded into the frame, and the story sending things with fetch().
// Images from other sites still load, and links to other sites open in a new tab.

const link = (story: string) => `/v7/#story=${encodeStory({ files: { "story.squiffy": story } })}`;

// A story whose JavaScript tries something when it starts, after logging that it's about to
const hostile = (js: string) => `@title Hostile\n\n[[start]]:\n\tconsole.log("trying");\n\t${js}\n\nA story.`;

// Another site, which answers with a sign-in page, or a picture. It's a real server, rather than
// Playwright's routing, which in WebKit sees a request before the Content-Security-Policy stops it.
let otherSite: Server;
let OTHER_SITE = "";
// The paths of the requests made to it, in this test
let requests: string[] = [];

test.beforeAll(async () => {
    otherSite = createServer((request, response) => {
        const path = new URL(request.url ?? "/", "http://localhost").pathname;
        if (path == "/favicon.ico") return response.writeHead(404).end();
        requests.push(path);
        if (path.endsWith(".svg")) {
            response.writeHead(200, { "Content-Type": "image/svg+xml" }).end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>');
        } else {
            response.writeHead(200, { "Content-Type": "text/html" }).end("<h1>Sign in</h1>");
        }
    });
    await new Promise<void>(resolve => otherSite.listen(0, "127.0.0.1", resolve));
    OTHER_SITE = `http://127.0.0.1:${(otherSite.address() as AddressInfo).port}`;
});

test.afterAll(() => new Promise<void>(resolve => otherSite.close(() => resolve())));

test.beforeEach(() => { requests = []; });

async function play(page: Page, story: string) {
    const tried = page.waitForEvent("console", message => message.text() == "trying");
    await page.goto(link(story));
    await tried;
    // Long enough for whatever it tried to happen, had it been allowed
    await page.waitForTimeout(1000);
}

const attempts: Record<string, (site: string) => string> = {
    "navigating its frame": site => `location.href = "${site}/navigate";`,
    "a meta refresh": site => `document.head.insertAdjacentHTML("beforeend", '<meta http-equiv="refresh" content="0;url=${site}/refresh">');`,
    "an iframe": site => `document.body.insertAdjacentHTML("beforeend", '<iframe src="${site}/iframe"></iframe>');`,
    "an object": site => `document.body.insertAdjacentHTML("beforeend", '<object data="${site}/object" type="text/html"></object>');`,
    "navigating the reader's tab": site => `try { top.location.href = "${site}/top"; } catch {}`,
};

for (const [name, js] of Object.entries(attempts)) {
    test(`a story can't show another site by ${name}`, async ({ page }) => {
        await play(page, hostile(js(OTHER_SITE)));
        expect(requests).toEqual([]);
        expect(page.url()).toMatch(/^http:\/\/localhost:5181\/v7\/#story=/);
        for (const frame of page.frames()) expect(frame.url()).not.toContain(OTHER_SITE);
    });
}

test("a story can't send things with fetch()", async ({ page }) => {
    const refused = page.waitForEvent("console", message => message.text() == "not sent");
    await play(page, hostile(`fetch("${OTHER_SITE}/fetch?typed=secret").then(() => console.log("sent"), () => console.log("not sent"));`));
    await refused;
    expect(requests).toEqual([]);
});

test("a story can show images from other sites", async ({ page }) => {
    await page.goto(link(`[[start]]:\nA picture: <img src="${OTHER_SITE}/picture.svg" alt="A picture">`));
    const image = page.frameLocator("#story").getByRole("img", { name: "A picture" });
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(20);
    expect(requests).toEqual(["/picture.svg"]);
});

test("a link to another site opens in a new tab, and the story stays", async ({ page }) => {
    await page.goto(link(`[[start]]:\nSee [the other site](${OTHER_SITE}/linked).`));
    const frame = page.frameLocator("#story");
    const opened = page.context().waitForEvent("page");
    await frame.getByRole("link", { name: "the other site" }).click();
    const tab = await opened;
    await tab.waitForLoadState();
    expect(tab.url()).toBe(`${OTHER_SITE}/linked`);
    await expect(tab.getByRole("heading", { name: "Sign in" })).toBeVisible();
    // Opened without a way back to the story's frame
    expect(await tab.evaluate(() => window.opener)).toBeNull();
    expect(requests).toEqual(["/linked"]);
    await expect(frame.getByRole("paragraph").filter({ hasText: "See the other site." })).toBeVisible();
});

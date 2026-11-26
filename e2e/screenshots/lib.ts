// Shared helpers for the docs' screenshots. Each *.capture.ts file takes the screenshots for one
// doc page, saving them in site/src/assets/screenshots/, where the docs embed them with
// <Screenshot> (site/src/components/Screenshot.astro). Run them with `npm run screenshots`.
import { test as base, expect, type Locator, type Page, type FrameLocator } from "@playwright/test";
import { zipSync } from "fflate";
import { readFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../..");
export const outDir = join(repoRoot, "site/src/assets/screenshots");
// The player the shots' editor makes links to (its VITE_PLAYER_URL), and its dev server, which
// plays them (both in playwright.screenshots.config.ts)
const PLAYER_URL = "https://squiffystories.com";
const LOCAL_PLAYER_URL = "http://localhost:5181";

type Rect = { x: number; y: number; width: number; height: number };

// Playwright's test, with Math.random seeded in every frame of every page (the preview's, and a
// tab from Play in a new tab), so a story that picks things at random picks the same ones each
// time. How many numbers have been used by the time the player clicks something can depend on
// timing, so choose() and reseed() seed it again just before each click.
export const test = base.extend({
    context: async ({ context }, use) => {
        await context.addInitScript(() => {
            let seed = 12345;
            Math.random = () => {
                seed = (seed * 1664525 + 1013904223) % 4294967296;
                return seed / 4294967296;
            };
            (window as unknown as { reseedRandom: () => void }).reseedRandom = () => { seed = 12345; };
        });
        // The map's hint on how to open a box, which is shown until one's been opened, isn't
        // what the shots are of
        await context.addInitScript(() => {
            try {
                localStorage.setItem("squiffy-map-open-hint-done", "1");
            } catch {
                // A frame without storage, such as the preview's
            }
        });
        // The home page's "Made with Squiffy" comes from textadventures.co.uk, and changes
        await context.route("https://textadventures.co.uk/**", route => route.abort());
        // The player, from its dev server in place of squiffystories.com: Play in a new tab sends
        // the story to its play page, which only takes one from the real editors, or (in
        // development) from one on this machine, as the shots' editor is (#644). Its links still
        // say squiffystories.com.
        await context.route(`${PLAYER_URL}/**`, async route => {
            const url = new URL(route.request().url());
            await route.fulfill({ response: await route.fetch({ url: `${LOCAL_PLAYER_URL}${url.pathname}${url.search}` }) });
        });
        await use(context);
    },
});
export { expect };

// A story's folder as a project .zip, as File > Download project makes one, leaving out its
// playthrough tests and anything that isn't part of the story
function zipFolder(folder: string, extraFiles: Record<string, string> = {}): Buffer {
    const files: Record<string, Uint8Array> = {};
    for (const [path, from] of Object.entries(extraFiles)) files[path] = readFileSync(join(repoRoot, from));
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) {
                if (name !== "tests" && name !== "build") walk(path);
            } else if (!/\.(py|squiffy-test|bak)$/.test(name)) {
                files[relative(folder, path)] = readFileSync(path);
            }
        }
    };
    walk(folder);
    return Buffer.from(zipSync(files));
}

// Opens a story folder (relative to the repo, such as "examples/gameshow") in the editor, through
// the home page's Open file, which copies a project .zip into the browser as a new story.
// extraFiles adds files from elsewhere in the repo, as { "path in the story": "path in the repo" }.
export async function openStory(page: Page, folder: string, extraFiles: Record<string, string> = {}) {
    await page.goto("/");
    const name = folder.split("/").pop()!;
    await page.locator("input[type=file]").setInputFiles({
        name: `${name}.zip`,
        mimeType: "application/zip",
        buffer: zipFolder(join(repoRoot, folder), extraFiles),
    });
    await page.waitForURL(/\/edit\?/);
    await expect(editor(page)).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

// Starts a new story from the home page, and replaces its starter text with this, as the
// tutorial has the reader do
export async function newStory(page: Page, text?: string) {
    await page.goto("/");
    await page.getByRole("button", { name: /^New story/ }).click();
    await page.waitForURL(/\/edit\?/);
    await expect(editor(page)).toBeVisible();
    if (text === undefined) return;
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText(text.trimEnd());
    await expect(editor(page)).toContainText(text.trimEnd().split("\n").pop()!);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

// A file in the repo, as text
export const repoFile = (path: string) => readFileSync(join(repoRoot, path), "utf8");

export const editor = (page: Page) => page.locator("#editor .cm-content:visible");

export async function setView(page: Page, view: "Code" | "Code + Map" | "Map") {
    await page.getByRole("group", { name: "View" }).getByRole("button", { name: view, exact: true }).click();
    if (view !== "Code") await expect(page.locator("[data-node]").first()).toBeVisible();
}

// Runs the story in the preview, and returns its frame
export async function run(page: Page): Promise<FrameLocator> {
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const frame = page.frameLocator("iframe[srcdoc], iframe").last();
    await expect(frame.locator("#squiffy a.squiffy-link, #squiffy .squiffy-link").first()).toBeVisible();
    return frame;
}

// Seeds Math.random again, in a page or the preview's frame, before something that may use it
export async function reseed(target: Page | FrameLocator) {
    await target.locator("body").evaluate(() => (window as unknown as { reseedRandom?: () => void }).reseedRandom?.());
}

// The story open in the editor, published, in a tab of its own: the preview's Run options, Play in
// a new tab. Returns the tab, as wide as the editor's window.
export async function playInNewTab(page: Page): Promise<Page> {
    const [tab] = await Promise.all([
        page.context().waitForEvent("page"),
        page.getByRole("button", { name: "Run options" }).click().then(() =>
            page.getByRole("menuitem", { name: "Play in a new tab" }).click()),
    ]);
    await tab.waitForURL(`${PLAYER_URL}/v7/play`);
    await tab.setViewportSize(page.viewportSize()!);
    await expect(tab.locator("a.squiffy-link").first()).toBeVisible();
    return tab;
}

// Clicks a link in the preview's frame, or in a published story's page, by its text, and waits
// for it to take effect
export async function choose(frame: FrameLocator | Page, text: string) {
    const link = frame.getByRole("link", { name: text, exact: true }).last();
    const blocks = frame.locator(".squiffy-output-block");
    const before = await blocks.count();
    await reseed(frame);
    // The preview may still be starting up, or running the last click's transition, and take no
    // notice of a click. So click until something's written.
    await expect(async () => {
        if (await blocks.count() === before) await link.click({ timeout: 2000 });
        expect(await blocks.count()).toBeGreaterThan(before);
    }).toPass({ timeout: 20_000 });
}

// Drags the splitter on the preview's left (or the map's) to make it wider (negative dx) or narrower
export async function resizePane(page: Page, pane: "preview" | "map", dx: number) {
    const splitters = page.locator(".splitter:not(.card-splitter):visible");
    // The sidebar's comes first, then the map's, then the preview's
    const splitter = pane === "preview" ? splitters.last() : splitters.nth(1);
    const box = (await splitter.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 5 });
    await page.mouse.up();
}

// Chooses an item from one of the toolbar's menus, such as File
export async function menu(page: Page, button: string, item: string) {
    await page.getByRole("button", { name: button, exact: true }).click();
    await page.getByRole("menuitem", { name: item }).click();
}

// The open dialog's panel. Pass it to around() for capture's clip: the page behind it is hidden,
// so it's on a plain background rather than dimmed script.
export function dialog(page: Page) {
    void page.addStyleTag({ content: "[role=dialog][aria-modal] { background: Canvas !important; }" });
    return page.locator("[role=dialog] > .card");
}

// A rectangle around an element, with some space around it, for capture's clip
export async function around(locator: Locator, padding = 16): Promise<Rect> {
    const box = (await locator.boundingBox())!;
    return { x: box.x - padding, y: box.y - padding, width: box.width + padding * 2, height: box.height + padding * 2 };
}

// Puts the cursor at the start of the first line with this text, scrolled to the top of the
// editor, so the script shows that part of the story
export async function goToLine(page: Page, text: string) {
    const line = editor(page).locator(".cm-line", { hasText: text }).first();
    await line.scrollIntoViewIfNeeded();
    await line.click({ position: { x: 1, y: 5 } });
}

// Lets animations, transitions and the map's layout finish, so each run's pictures are the same
export async function settle(page: Page) {
    // Images and fonts loading. VS Code for the web never goes quiet, so it's only a few seconds.
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    // The map is laid out by a simulation, which runs for a while after any change, and the
    // story's animations and transitions run in the preview, taking no notice of reduced motion.
    // Wait until nothing on the map or in the preview has moved or faded for a moment.
    const snapshot = async () => {
        const parts = await Promise.all(page.frames().map(frame => frame.evaluate(() => {
            const els = document.querySelectorAll("[data-node], .squiffy-output-section, .squiffy-animate, .squiffy-animate *");
            return [...els].map(e => {
                const r = e.getBoundingClientRect();
                return `${Math.round(r.x)},${Math.round(r.y)},${getComputedStyle(e).opacity}`;
            }).join(" ") + (document.body?.innerText.length ?? 0);
        }).catch(() => "")));
        return parts.join("|");
    };
    let last = "";
    for (let i = 0; i < 60; i++) {
        const now = await snapshot();
        if (now === last) break;
        last = now;
        await page.waitForTimeout(300);
    }
    // The cursor blinks: CodeMirror's with a CSS animation, VS Code's by script, so that one's hidden
    await page.addStyleTag({ content: ".cm-cursorLayer { animation: none !important; } .monaco-editor .cursors-layer { visibility: hidden !important; }" }).catch(() => {});
}

interface CaptureOptions {
    // Only this part of the page: an element, or a rectangle in CSS pixels
    clip?: Locator | Rect;
    // Light and dark versions, as name.png and name-dark.png. The docs show the one that matches
    // the site's theme.
    themes?: boolean;
    // How to switch between them, for a page that doesn't follow the system's light or dark mode
    setTheme?: (dark: boolean) => Promise<void>;
    // Another folder (relative to the repo) to save it in, such as the VS Code extension's
    // walkthrough pictures, in vscode/media/walkthrough/
    dir?: string;
}

// Saves a screenshot as site/src/assets/screenshots/<name>.png (or in options.dir)
export async function capture(page: Page, name: string, options: CaptureOptions = {}) {
    const { clip, themes = true } = options;
    const setTheme = options.setTheme ?? (dark => page.emulateMedia({ colorScheme: dark ? "dark" : "light" }));
    const dir = options.dir ? join(repoRoot, options.dir) : outDir;
    mkdirSync(dir, { recursive: true });
    const shoot = async (file: string) => {
        await settle(page);
        const path = join(dir, file);
        if (clip && "screenshot" in clip) await clip.screenshot({ path, animations: "disabled" });
        else await page.screenshot({ path, animations: "disabled", clip });
    };
    await setTheme(false);
    await shoot(`${name}.png`);
    if (themes) {
        await setTheme(true);
        await shoot(`${name}-dark.png`);
        await setTheme(false);
    }
}

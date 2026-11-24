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

// Playwright's test, with Math.random seeded in every frame (the preview's too), so a story that
// picks things at random picks the same ones each time
export const test = base.extend({
    page: async ({ page }, use) => {
        await page.addInitScript(() => {
            let seed = 12345;
            Math.random = () => {
                seed = (seed * 1664525 + 1013904223) % 4294967296;
                return seed / 4294967296;
            };
        });
        await use(page);
    },
});
export { expect };

// A story's folder as a project .zip, as File > Download project makes one, leaving out its
// playthrough tests and anything that isn't part of the story
function zipFolder(folder: string): Buffer {
    const files: Record<string, Uint8Array> = {};
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
// the home page's Open file, which copies a project .zip into the browser as a new story
export async function openStory(page: Page, folder: string) {
    await page.goto("/");
    const name = folder.split("/").pop()!;
    await page.locator("input[type=file]").setInputFiles({
        name: `${name}.zip`,
        mimeType: "application/zip",
        buffer: zipFolder(join(repoRoot, folder)),
    });
    await page.waitForURL(/\/edit\?/);
    await expect(editor(page)).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

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

// Clicks a link in the preview, by its text, and waits for it to take effect
export async function choose(frame: FrameLocator, text: string) {
    const link = frame.getByRole("link", { name: text, exact: true }).last();
    const blocks = frame.locator(".squiffy-output-block");
    const before = await blocks.count();
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

// Puts the cursor at the start of the first line with this text, scrolled to the top of the
// editor, so the script shows that part of the story
export async function goToLine(page: Page, text: string) {
    const line = editor(page).locator(".cm-line", { hasText: text }).first();
    await line.scrollIntoViewIfNeeded();
    await line.click({ position: { x: 1, y: 5 } });
}

// Lets animations, transitions and the map's layout finish, so each run's pictures are the same
export async function settle(page: Page) {
    await page.waitForLoadState("networkidle");
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
    // The cursor blinks
    await page.addStyleTag({ content: ".cm-cursorLayer { animation: none !important; }" }).catch(() => {});
}

type Rect = { x: number; y: number; width: number; height: number };

interface CaptureOptions {
    // Only this part of the page: an element, or a rectangle in CSS pixels
    clip?: Locator | Rect;
    // Light and dark versions, as name.png and name-dark.png. The docs show the one that matches
    // the site's theme.
    themes?: boolean;
    // How to switch between them, for a page that doesn't follow the system's light or dark mode
    setTheme?: (dark: boolean) => Promise<void>;
}

// Saves a screenshot as site/src/assets/screenshots/<name>.png
export async function capture(page: Page, name: string, options: CaptureOptions = {}) {
    const { clip, themes = true } = options;
    const setTheme = options.setTheme ?? (dark => page.emulateMedia({ colorScheme: dark ? "dark" : "light" }));
    mkdirSync(outDir, { recursive: true });
    const shoot = async (file: string) => {
        await settle(page);
        const path = join(outDir, file);
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

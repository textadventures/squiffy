// The desktop app (desktop/), driven with Playwright's Electron support: "The desktop app". It needs
// the editor's static build and the desktop app's own: `npm run build` in app/, then
// `npm install && npm run build` in desktop/.
//
// It runs with a userData folder of its own, so it doesn't touch your settings or recent folders,
// and the paths it shows are made up rather than your own. Only the window's contents are
// captured: the title bar and the native menu are drawn by the OS.
import { test, expect, around, capture, dialog, repoRoot } from "./lib.js";
import { _electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const desktop = join(repoRoot, "desktop");
// Made-up paths, which the app shows but never opens, and times in the computer's own time zone,
// so the list says the same everywhere
const documents = "/Users/you/Documents/Squiffy";
const recentFolders = [
    { name: "The Wheel of Dubious Fortune", mainFile: "gameshow.squiffy", lastOpened: new Date(2026, 10, 24, 10, 30).getTime() },
    { name: "The Island", mainFile: "story.squiffy", lastOpened: new Date(2026, 10, 23, 16, 5).getTime() },
    { name: "The Cave", mainFile: "story.squiffy", lastOpened: new Date(2026, 10, 20, 9, 45).getTime() },
];

let app: ElectronApplication;
let window: Page;
let userData: string;

test.beforeEach(async () => {
    userData = mkdtempSync(join(tmpdir(), "squiffy-screenshots-"));
    writeFileSync(join(userData, "recent-folders.json"), JSON.stringify(recentFolders.map((f, i) => ({
        id: `recent-${i}`, path: `${documents}/${f.name}`, mainFile: f.mainFile, lastOpened: f.lastOpened,
    }))));
    writeFileSync(join(userData, "new-story.json"), JSON.stringify({ location: documents }));
    const electron = createRequire(join(desktop, "package.json"))("electron") as unknown as string;
    app = await _electron.launch({ executablePath: electron, args: [desktop, `--user-data-dir=${userData}`], cwd: desktop });
    // As in the browser: the home page's "Made with Squiffy" comes from textadventures.co.uk
    await app.context().route("https://textadventures.co.uk/**", route => route.abort());
    window = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 810));
    await expect(window.getByRole("button", { name: /^New story/ })).toBeVisible();
});

test.afterEach(async () => {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
});

test("the desktop app's home page, with recent folders", async () => {
    await expect(window.getByText("The Wheel of Dubious Fortune").first()).toBeVisible();
    // Down to the bottom of the list, as the rest of the page is empty
    const list = await around(window.getByRole("region", { name: "Recent folders" }), 0);
    await capture(window, "desktop-home", { clip: { x: 0, y: 0, width: 1440, height: list.y + list.height + 48 } });
});

test("New story asks for the story's name", async () => {
    await window.getByRole("button", { name: /^New story/ }).click();
    await expect(dialog(window)).toBeVisible();
    await dialog(window).getByRole("textbox").first().fill("The Lighthouse");
    await capture(window, "desktop-new-story", { clip: await around(dialog(window)) });
});

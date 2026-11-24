// The desktop app's Play in a new tab (#644): the published story is someone's JavaScript, so its
// window must have nothing of the editor's. Before, the editor opened it itself (about:blank, then
// a blob: URL), which gave it the editor's origin and window.opener, and through them the editor's
// bridges: a story could open a recent folder and write files in it.
//
// Runs the built desktop app (`./electron.sh` builds it), with a userData folder of its own:
//     npx playwright test --project=desktop
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

const desktop = join(import.meta.dirname, "..", "..", "desktop");
const built = existsSync(join(desktop, "dist", "main.js")) && existsSync(join(desktop, "..", "app", "build", "index.html"));

test.skip(!built, "Build the desktop app first: ./electron.sh");

let app: ElectronApplication;
let editor: Page;

// The app, with a userData folder of its own, opening a story file if it's given one, as if the OS
// had asked it to
async function launch(storyFile?: string) {
    const require = createRequire(join(desktop, "package.json"));
    app = await electron.launch({
        executablePath: require("electron") as unknown as string,
        args: [desktop, `--user-data-dir=${test.info().outputPath("userdata")}`, ...(storyFile ? [storyFile] : [])],
        cwd: desktop,
    });
    editor = await app.firstWindow();
    await editor.waitForLoadState("load");
}

test.afterEach(async () => {
    await app?.close();
});

// What a story can see from its window, written into its title
const probe = `<!doctype html><title>probe</title><script>
(() => {
  const r = { origin: location.origin, opener: !!window.opener, desktop: typeof window.squiffyDesktop, projectFs: typeof window.projectFs };
  try { localStorage.setItem("probe", "saved"); r.storage = localStorage.getItem("probe"); } catch (e) { r.storage = String(e); }
  r.popup = !!window.open("about:blank", "_blank");
  document.title = "RESULT " + JSON.stringify(r);
})();
</script>`;

test("the editor can't open a window of its own origin", async () => {
    await launch();
    expect(await editor.evaluate(() => !!window.open("", "_blank"))).toBe(false);
    expect(app.windows()).toHaveLength(1);
});

test("a played story gets a window with its own origin and nothing of the editor's", async () => {
    await launch();
    expect(await editor.evaluate(() => typeof (window as { squiffyDesktop?: unknown }).squiffyDesktop)).toBe("object");
    const opened = app.waitForEvent("window");
    await editor.evaluate(html => (window as unknown as { squiffyDesktop: { playStory(html: string): Promise<void> } }).squiffyDesktop.playStory(html), probe);
    const story = await opened;
    await story.waitForFunction(() => document.title.startsWith("RESULT "));
    const result = JSON.parse((await story.title()).slice("RESULT ".length));
    expect(result).toEqual({ origin: "story://play", opener: false, desktop: "undefined", projectFs: "undefined", storage: "saved", popup: false });

    // Restart reloads the page, which still has the story
    await story.reload();
    await story.waitForFunction(() => document.title.startsWith("RESULT "));
    expect(JSON.parse((await story.title()).slice("RESULT ".length)).origin).toBe("story://play");
});

test("only the editor can play a story", async () => {
    await launch();
    const opened = app.waitForEvent("window");
    await editor.evaluate(html => (window as unknown as { squiffyDesktop: { playStory(html: string): Promise<void> } }).squiffyDesktop.playStory(html), probe);
    const story = await opened;
    await story.waitForFunction(() => document.title.startsWith("RESULT "));
    // The story's window has no preload, so no ipcRenderer to call play-story with, and the main
    // process would refuse it anyway, as it isn't the editor's window
    expect(await story.evaluate(() => typeof (window as { require?: unknown }).require)).toBe("undefined");
    expect(app.windows()).toHaveLength(2);
});

test("Play in a new tab plays the story in a story window", async () => {
    const folder = test.info().outputPath("story");
    mkdirSync(folder, { recursive: true });
    const file = join(folder, "story.squiffy");
    writeFileSync(file, "Hello from the story.\n");
    await launch(file);
    await editor.getByRole("button", { name: "Run options" }).click();
    const opened = app.waitForEvent("window");
    await editor.getByRole("menuitem", { name: "Play in a new tab" }).click();
    const story = await opened;
    await expect(story.getByText("Hello from the story.")).toBeVisible();
    expect(await story.evaluate(() => ({ origin: location.origin, opener: !!window.opener, desktop: typeof (window as { squiffyDesktop?: unknown }).squiffyDesktop })))
        .toEqual({ origin: "story://play", opener: false, desktop: "undefined" });
});

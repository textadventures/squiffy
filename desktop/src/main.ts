import { promises as fsp } from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent, type OpenDialogOptions, type WebContents } from "electron";
import { registerProjectFsHandlers } from "@textadventures/project-fs/electron-main";
import { CHANNEL_PREFIX, type MenuAction, type NewStoryResult, type OpenedRecentFolder } from "./api.js";
import { APP_ORIGIN, handleAppScheme, registerAppScheme } from "./app-protocol.js";
import { buildMenu } from "./menu.js";
import { NewStoryLocation } from "./new-story.js";
import { RecentFolders, toInfo } from "./recent.js";
import { loadWindowState, trackWindowState } from "./window-state.js";

const here = nodePath.dirname(fileURLToPath(import.meta.url));

// `npm run dev` loads the editor from its Vite dev server (`npm run dev` in app/), so it hot-reloads
const devServer = process.argv.includes("--dev-server");
const appOrigin = devServer ? `http://localhost:${process.env.PORT || 5180}` : APP_ORIGIN;

// The editor's static build: copied into the app's resources when it's packaged, and straight
// from app/build when it's run from the repo
function staticRoot(): string {
    return app.isPackaged ? nodePath.join(process.resourcesPath, "app-static") : nodePath.resolve(app.getAppPath(), "../app/build");
}

// The app's icon as a PNG, for the window on Linux (elsewhere it comes from the app bundle) and
// the About panel on Windows and Linux. scripts/dist.mjs puts the right channel's in the resources.
function iconPath(): string {
    return app.isPackaged ? nodePath.join(process.resourcesPath, "icon.png") : nodePath.resolve(app.getAppPath(), "build/icons/512x512.png");
}

registerAppScheme();

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    void start();
}

let mainWindow: BrowserWindow | null = null;
let readyToClose = false;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let quitting = false;
const recent = new RecentFolders(nodePath.join(app.getPath("userData"), "recent-folders.json"));
const newStoryLocation = new NewStoryLocation(
    nodePath.join(app.getPath("userData"), "new-story.json"),
    nodePath.join(app.getPath("documents"), "Squiffy"),
);

// A file the OS asked the app to open before it was ready (macOS sends open-file early)
let pendingOpen: string | null = null;
app.on("open-file", (event, path) => {
    event.preventDefault();
    if (app.isReady()) void openPath(path);
    else pendingOpen = path;
});

async function start() {
    await app.whenReady();
    if (!devServer) handleAppScheme(staticRoot());
    if (process.platform === "darwin") {
        // As Quest Viva does: the name, icon and copyright (electron-builder's default,
        // "Copyright © <year> <author>") come from the app bundle. macOS shows the build number
        // after the version, and Electron makes that the version too, so it's emptied rather
        // than showing the version twice. Passing iconPath would show a PNG instead of the
        // bundle's icon, which macOS draws in a grey frame.
        app.setAboutPanelOptions({ version: "" });
    } else {
        // Windows and Linux have no defaults: anything left unset is blank
        app.setAboutPanelOptions({
            applicationName: app.getName(),
            applicationVersion: app.getVersion(),
            copyright: `Copyright © ${new Date().getFullYear()} Alex Warren`,
            website: "https://squiffystory.com",
            iconPath: iconPath(),
        });
    }

    const projectFs = registerProjectFsHandlers({
        ipcMain,
        // Attached to the editor's window, so on a Mac it's a sheet
        dialog: {
            showOpenDialog: (options) => {
                const o = options as OpenDialogOptions;
                return mainWindow ? dialog.showOpenDialog(mainWindow, o) : dialog.showOpenDialog(o);
            },
        },
    });
    registerDesktopHandlers(projectFs);
    await refreshMenu();

    const initial = pendingOpen ?? pathFromArgv(process.argv);
    const id = initial ? await rememberOpenedPath(initial) : null;
    createWindow(id ? editRoute(id) : "/");

    app.on("second-instance", (_event, argv) => {
        const path = pathFromArgv(argv);
        if (path) void openPath(path);
        else focusWindow();
    });
    app.on("activate", () => {
        if (!mainWindow) createWindow("/");
    });
    app.on("before-quit", () => {
        quitting = true;
    });
    app.on("window-all-closed", () => {
        if (process.platform !== "darwin" || quitting) app.quit();
    });
}

const editRoute = (id: string) => `/edit?folder=${encodeURIComponent(id)}`;

function createWindow(route: string) {
    const state = loadWindowState();
    const win = new BrowserWindow({
        ...state.bounds,
        minWidth: 480,
        minHeight: 360,
        title: app.getName(),
        show: false,
        ...(process.platform === "linux" ? { icon: iconPath() } : {}),
        webPreferences: {
            preload: nodePath.join(here, "preload.cjs"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });
    if (state.maximized) win.maximize();
    trackWindowState(win);
    mainWindow = win;
    readyToClose = false;

    // Shown once it's drawn, so it doesn't flash white. But on Linux with Wayland a hidden window
    // may never draw, so ready-to-show never comes: show it when the page has loaded, at the latest.
    const show = () => {
        if (!win.isDestroyed() && !win.isVisible()) win.show();
    };
    win.once("ready-to-show", show);
    win.webContents.once("did-finish-load", show);
    void win.loadURL(appOrigin + route);

    // Give the editor a chance to save before the window goes. It answers with close-ready; if it
    // doesn't within a few seconds, close anyway.
    win.on("close", (event) => {
        if (readyToClose) return;
        event.preventDefault();
        win.webContents.send(CHANNEL_PREFIX + "before-close");
        clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
            if (!win.isDestroyed()) {
                readyToClose = true;
                win.close();
            }
        }, 5000);
    });
    win.on("closed", () => {
        if (mainWindow === win) mainWindow = null;
    });
}

function focusWindow() {
    if (!mainWindow) {
        createWindow("/");
        return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
}

// Every window, including ones the editor opens: links to other sites go to the browser, and
// nothing navigates away from the editor
app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
        // Play in a new tab opens about:blank and then shows the published story from a blob: URL
        if (url === "about:blank" || url.startsWith("blob:")) {
            return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true } };
        }
        openExternal(url);
        return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
        if (isAppUrl(url) || url.startsWith("blob:") || url === "about:blank") return;
        event.preventDefault();
        openExternal(url);
    });
    // The editor asks before leaving while it has unsaved changes. A browser shows a prompt for
    // that; Electron just cancels, so ask here.
    contents.on("will-prevent-unload", (event) => {
        const win = BrowserWindow.fromWebContents(contents);
        const options = {
            type: "warning" as const,
            buttons: ["Leave", "Stay"],
            defaultId: 1,
            cancelId: 1,
            message: "Some changes haven't been saved yet.",
            detail: "If you leave now, they'll be lost.",
        };
        const choice = win ? dialog.showMessageBoxSync(win, options) : dialog.showMessageBoxSync(options);
        if (choice === 0) event.preventDefault();
    });
});

function isAppUrl(url: string): boolean {
    try {
        return new URL(url).origin === appOrigin;
    } catch {
        return false;
    }
}

function openExternal(url: string) {
    try {
        const { protocol } = new URL(url);
        if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") void shell.openExternal(url);
    } catch {
        // Not a URL: ignore it
    }
}

// Only the editor's own window, and not a frame inside it, can use the desktop API
function fromEditor(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
    return !!mainWindow && event.sender === mainWindow.webContents && event.senderFrame === event.sender.mainFrame;
}

type ProjectFsMain = ReturnType<typeof registerProjectFsHandlers>;

function registerDesktopHandlers(projectFs: ProjectFsMain) {
    function handle(name: string, fn: (sender: WebContents, ...args: unknown[]) => Promise<unknown>) {
        ipcMain.handle(CHANNEL_PREFIX + name, (event, ...args) => {
            if (!fromEditor(event)) throw new Error("Not allowed");
            return fn(event.sender, ...args);
        });
    }
    const mainFileArg = (value: unknown) => (typeof value === "string" && value.length < 1024 ? value : "");

    handle("recent:list", async () => (await recent.list()).map(toInfo));
    handle("recent:open", async (sender, id): Promise<OpenedRecentFolder | null> => {
        const entry = await recent.find(id);
        if (!entry) return null;
        try {
            const info = await projectFs.approveRoot(sender, entry.path);
            return { ...info, mainFile: entry.mainFile };
        } catch {
            // Moved or deleted
            return null;
        }
    });
    handle("recent:remember", async (sender, rootId, mainFile) => {
        const path = projectFs.rootPath(sender, rootId);
        if (!path) throw new Error("Unknown project root");
        const id = await recent.add(path, mainFileArg(mainFile));
        await recentChanged();
        return id;
    });
    handle("recent:update", async (_sender, id, mainFile) => {
        if (typeof id !== "string") return;
        await recent.update(id, mainFileArg(mainFile));
        await recentChanged();
    });
    handle("recent:forget", async (_sender, id) => {
        if (typeof id !== "string") return;
        await recent.forget(id);
        await recentChanged();
    });

    handle("new-story:location", () => newStoryLocation.start());
    handle("new-story:choose-location", async () => {
        const current = await newStoryLocation.current();
        const options: OpenDialogOptions = {
            title: "Choose where to make new stories",
            message: "Choose where to make new stories",
            buttonLabel: "Choose",
            // It may not exist yet, if it's the default and no story's been made there
            defaultPath: await fsp.stat(current).then(() => current, () => nodePath.dirname(current)),
            properties: ["openDirectory", "createDirectory"],
        };
        const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
        if (result.canceled || result.filePaths.length === 0) return null;
        newStoryLocation.pick(result.filePaths[0]);
        return result.filePaths[0];
    });
    handle("new-story:create", async (sender, name): Promise<NewStoryResult> => {
        const result = await newStoryLocation.createFolder(name);
        if (!result.ok) return result;
        return { ok: true, root: await projectFs.approveRoot(sender, result.path) };
    });

    ipcMain.on(CHANNEL_PREFIX + "close-ready", (event) => {
        if (!fromEditor(event) || !mainWindow) return;
        clearTimeout(closeTimer);
        readyToClose = true;
        mainWindow.close();
    });
}

async function recentChanged() {
    await refreshMenu();
    mainWindow?.webContents.send(CHANNEL_PREFIX + "recent-changed");
}

async function refreshMenu() {
    buildMenu({
        recent: (await recent.list()).map(toInfo),
        isDev: !app.isPackaged,
        onAction: sendAction,
        onOpenRecent: (id) => openRecent(id),
        onClearRecent: async () => {
            await recent.clear();
            await recentChanged();
        },
        openExternal,
    });
}

function sendAction(action: MenuAction) {
    if (!mainWindow) {
        if (action === "undo" || action === "redo") return;
        createWindow("/");
        return;
    }
    mainWindow.webContents.send(CHANNEL_PREFIX + "menu", action);
}

function openRecent(id: string) {
    if (!mainWindow) {
        createWindow(editRoute(id));
        return;
    }
    focusWindow();
    mainWindow.webContents.send(CHANNEL_PREFIX + "open-recent", id);
}

// A .squiffy file (or a folder) the OS asked the app to open: double-clicked, dropped on the
// app's icon, or passed on the command line
async function openPath(path: string) {
    const id = await rememberOpenedPath(path);
    if (id) openRecent(id);
}

async function rememberOpenedPath(path: string): Promise<string | null> {
    try {
        const real = await fsp.realpath(path);
        const stat = await fsp.stat(real);
        const id = stat.isDirectory()
            ? await recent.add(real, "")
            : real.toLowerCase().endsWith(".squiffy") ? await recent.add(nodePath.dirname(real), nodePath.basename(real).normalize("NFC")) : null;
        if (id) await refreshMenu();
        return id;
    } catch {
        return null;
    }
}

function pathFromArgv(argv: string[]): string | null {
    // argv[0] is the app; when run from the repo, argv[1] is the app's folder
    const args = argv.slice(app.isPackaged ? 1 : 2).filter(a => !a.startsWith("-"));
    return args.find(a => a.toLowerCase().endsWith(".squiffy")) ?? null;
}

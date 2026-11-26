import { app, Menu, type MenuItemConstructorOptions } from "electron";
import type { MenuAction, RecentFolderInfo } from "./api.js";

// The native menu. File commands go to the editor (menu actions), which does what its own
// buttons do. Shortcuts the editor handles itself (Ctrl/Cmd+Shift+O, Ctrl/Cmd+Enter) are left
// off the menu, since a menu accelerator would take the key first.
// Undo and Redo go to the editor too: the built-in roles run the browser's own undo, which
// knows nothing of CodeMirror's history (CodeMirror changes the DOM itself), so they did nothing.

export interface MenuOptions {
    recent: RecentFolderInfo[];
    isDev: boolean;
    onAction(action: MenuAction): void;
    onOpenRecent(id: string): void;
    onClearRecent(): void;
    openExternal(url: string): void;
}

const DOCS_URL = "https://squiffystory.com";
const ISSUES_URL = "https://github.com/textadventures/squiffy/issues";

export function buildMenu(options: MenuOptions): void {
    const { recent, isDev, onAction, onOpenRecent, onClearRecent, openExternal } = options;
    const isMac = process.platform === "darwin";

    const recentItems: MenuItemConstructorOptions[] = recent.length
        ? [
            ...recent.map((folder): MenuItemConstructorOptions => ({
                label: folder.displayPath,
                click: () => onOpenRecent(folder.id),
            })),
            { type: "separator" },
            { label: "Clear Recent", click: () => onClearRecent() },
        ]
        : [{ label: "No recent folders", enabled: false }];

    const template: MenuItemConstructorOptions[] = [
        ...(isMac
            ? [{
                label: app.name,
                submenu: [
                    { role: "about" },
                    { type: "separator" },
                    { label: "Settings…", accelerator: "Cmd+,", click: () => onAction("settings") },
                    { type: "separator" },
                    { role: "services" },
                    { type: "separator" },
                    { role: "hide" },
                    { role: "hideOthers" },
                    { role: "unhide" },
                    { type: "separator" },
                    { role: "quit" },
                ],
            } satisfies MenuItemConstructorOptions]
            : []),
        {
            label: "File",
            submenu: [
                { label: "New Story…", accelerator: "CmdOrCtrl+N", click: () => onAction("new-story") },
                { label: "Open Folder…", accelerator: "CmdOrCtrl+O", click: () => onAction("open-folder") },
                { label: "Open File…", click: () => onAction("open-file") },
                { label: "Import from Twine or Quest…", click: () => onAction("import-story") },
                { label: "Open Recent", submenu: recentItems },
                { type: "separator" },
                { label: "Save", accelerator: "CmdOrCtrl+S", click: () => onAction("save") },
                { type: "separator" },
                { label: "Close Story", click: () => onAction("close-story") },
                ...(isMac
                    ? [{ role: "close" } satisfies MenuItemConstructorOptions]
                    : [
                        { type: "separator" },
                        { label: "Settings…", accelerator: "Ctrl+,", click: () => onAction("settings") },
                        { type: "separator" },
                        { role: "quit" },
                    ] satisfies MenuItemConstructorOptions[]),
            ],
        },
        {
            label: "Edit",
            submenu: [
                { label: "Undo", accelerator: "CmdOrCtrl+Z", click: () => onAction("undo") },
                { label: "Redo", accelerator: isMac ? "Shift+Cmd+Z" : "Ctrl+Y", click: () => onAction("redo") },
                { type: "separator" },
                { role: "cut" },
                { role: "copy" },
                { role: "paste" },
                ...(isMac
                    ? [
                        { role: "pasteAndMatchStyle" },
                        { role: "delete" },
                        { role: "selectAll" },
                        { type: "separator" },
                        { label: "Speech", submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }] },
                    ] satisfies MenuItemConstructorOptions[]
                    : [
                        { role: "delete" },
                        { type: "separator" },
                        { role: "selectAll" },
                    ] satisfies MenuItemConstructorOptions[]),
            ],
        },
        {
            label: "View",
            submenu: [
                { role: "reload" },
                ...(isDev ? [{ role: "toggleDevTools" } satisfies MenuItemConstructorOptions] : []),
                { type: "separator" },
                { role: "resetZoom" },
                { role: "zoomIn" },
                { role: "zoomOut" },
                { type: "separator" },
                { role: "togglefullscreen" },
            ],
        },
        { role: "windowMenu" },
        {
            role: "help",
            submenu: [
                { label: "Squiffy Documentation", click: () => openExternal(`${DOCS_URL}/getting-started/`) },
                { label: "Keyboard Shortcuts", click: () => onAction("keyboard-shortcuts") },
                { label: "Report an Issue", click: () => openExternal(ISSUES_URL) },
                ...(isMac ? [] : [{ type: "separator" }, { role: "about" }] satisfies MenuItemConstructorOptions[]),
            ],
        },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

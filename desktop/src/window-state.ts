import { readFileSync, writeFileSync } from "node:fs";
import * as nodePath from "node:path";
import { app, screen, type BrowserWindow, type Rectangle } from "electron";

// The editor window's size and position, remembered between launches

interface WindowState {
    bounds: Partial<Rectangle> & { width: number; height: number };
    maximized: boolean;
}

const DEFAULT: WindowState = { bounds: { width: 1280, height: 820 }, maximized: false };

const file = () => nodePath.join(app.getPath("userData"), "window-state.json");

export function loadWindowState(): WindowState {
    try {
        const saved = JSON.parse(readFileSync(file(), "utf8")) as WindowState;
        const { x, y, width, height } = saved.bounds;
        if (![width, height].every(n => typeof n === "number" && n >= 200)) return DEFAULT;
        // Only put it back where it was if that's still on a screen
        const visible = typeof x === "number" && typeof y === "number" &&
            screen.getAllDisplays().some(d => intersects(d.workArea, { x, y, width, height }));
        return { bounds: visible ? { x, y, width, height } : { width, height }, maximized: !!saved.maximized };
    } catch {
        return DEFAULT;
    }
}

export function trackWindowState(win: BrowserWindow): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
        if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
        const state: WindowState = { bounds: win.isMaximized() ? win.getNormalBounds() : win.getBounds(), maximized: win.isMaximized() };
        try {
            writeFileSync(file(), JSON.stringify(state));
        } catch {
            // Not worth bothering anyone about
        }
    };
    const later = () => {
        clearTimeout(timer);
        timer = setTimeout(save, 500);
    };
    win.on("resize", later);
    win.on("move", later);
    win.on("close", () => {
        clearTimeout(timer);
        save();
    });
}

function intersects(a: Rectangle, b: Rectangle): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

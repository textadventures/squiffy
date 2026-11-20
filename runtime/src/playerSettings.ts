// Player settings (#452): options from squiffy.json's "settings" that the player can change at any
// time, such as text size or content warnings. The story reads them as settings.name. They're the
// player's, not the game's, so they aren't attributes: going back, restarting and loading a saved
// game leave them as they are. They're kept for the story in localStorage, like Mute.

import type { PlayerSetting, SettingValue } from "./types.js";

export class PlayerSettings {
    // The values the player has changed, by name. A setting that isn't here has its default.
    private values: Record<string, SettingValue> = {};

    constructor(private getDefinitions: () => PlayerSetting[], private storageKey?: string) {
        if (!storageKey) return;
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
            if (saved && typeof saved == "object" && !Array.isArray(saved)) this.values = saved;
        }
        catch {
            // Nothing saved, or storage that can't be read: every setting has its default
        }
    }

    definitions() {
        return this.getDefinitions().filter(setting => setting && typeof setting.name == "string");
    }

    private find(name: string) {
        return this.definitions().find(setting => setting.name == name);
    }

    // Whether the story has any settings, which is when it reads settings.name as a setting
    any() {
        return this.definitions().length > 0;
    }

    get(name: string): SettingValue | null {
        const setting = this.find(name);
        if (!setting) return null;
        const value = Object.prototype.hasOwnProperty.call(this.values, name) ? this.values[name] : undefined;
        return value !== undefined && isValid(setting, value) ? value : defaultValue(setting);
    }

    // Every setting's value, by name: the "settings" the story reads
    all(): Record<string, SettingValue> {
        return Object.fromEntries(this.definitions().map(setting => [setting.name, this.get(setting.name)!]));
    }

    // Returns whether the value changed. One the setting can't have is ignored.
    set(name: string, value: SettingValue): boolean {
        const setting = this.find(name);
        if (!setting) return false;
        const coerced = coerce(setting, value);
        if (coerced === null || coerced === this.get(name)) return false;
        this.values[name] = coerced;
        this.store();
        return true;
    }

    reset() {
        this.values = {};
        this.store();
    }

    // The classes the settings put on the story's element, so the story's CSS can use them: a
    // toggle's name while it's on (setting-warnings), and a list's or range's name and value
    // (setting-textSize-Large)
    classes(): string[] {
        const classes: string[] = [];
        for (const setting of this.definitions()) {
            const value = this.get(setting.name);
            if (setting.type == "toggle") {
                if (value === true) classes.push(`setting-${setting.name}`);
            }
            else if (value !== null) {
                classes.push(`setting-${setting.name}-${String(value).replace(/[^A-Za-z0-9_-]+/g, "-")}`);
            }
        }
        return classes;
    }

    private store() {
        if (!this.storageKey) return;
        try {
            if (Object.keys(this.values).length) localStorage.setItem(this.storageKey, JSON.stringify(this.values));
            else localStorage.removeItem(this.storageKey);
        }
        catch {
            // Storage that's full or turned off: the setting lasts until the page is closed
        }
    }
}

export function defaultValue(setting: PlayerSetting): SettingValue {
    switch (setting.type) {
        case "toggle": return setting.default ?? false;
        case "list": return setting.default ?? setting.options[0]?.value ?? "";
        case "range": return setting.default ?? setting.min;
    }
}

function isValid(setting: PlayerSetting, value: unknown) {
    return coerce(setting, value) === value;
}

// The value as the setting has it, e.g. "true" for a toggle is true and "3" for a range is 3, or
// null if the setting can't have it. A range's value is kept within min and max, on a step.
function coerce(setting: PlayerSetting, value: unknown): SettingValue | null {
    switch (setting.type) {
        case "toggle":
            if (typeof value == "boolean") return value;
            if (value === "true") return true;
            if (value === "false") return false;
            return null;
        case "list": {
            const text = typeof value == "string" || typeof value == "number" || typeof value == "boolean" ? String(value) : null;
            return text !== null && setting.options.some(option => option.value === text) ? text : null;
        }
        case "range": {
            const n = typeof value == "number" ? value : typeof value == "string" && value.trim() ? Number(value) : NaN;
            if (!Number.isFinite(n)) return null;
            const clamped = Math.min(setting.max, Math.max(setting.min, n));
            if (!setting.step) return clamped;
            const stepped = setting.min + Math.round((clamped - setting.min) / setting.step) * setting.step;
            // Without the rounding errors of adding up steps such as 0.1
            return Number(Math.min(setting.max, stepped).toFixed(10));
        }
    }
}

import { describe, expect, test } from "vitest";
import type { KeyBinding } from "@codemirror/view";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { editorSearchKeymap } from "@textadventures/editor-search";
import { foldKeymap } from "@codemirror/language";
import { nextDiagnostic } from "@codemirror/lint";
import { completionKeymap } from "@codemirror/autocomplete";
import { EDITOR_KEYS, SHORTCUT_GROUPS, formatKey, keyNames } from "./shortcuts.js";

// The keymaps CodeEditor.svelte loads
const keymaps: KeyBinding[] = [...defaultKeymap, ...historyKeymap, ...editorSearchKeymap, ...foldKeymap, { key: "F8", run: nextDiagnostic }, ...completionKeymap];

// Each modifier order CodeMirror accepts means the same, so compare them sorted
function normalise(key: string) {
    const parts = key.split(/-(?!$)/);
    const last = parts.pop()!.toLowerCase();
    return [...parts.map(p => (p === "Meta" ? "Cmd" : p)).sort(), last].join("-");
}

function bound(key: string, mac: boolean) {
    const wanted = normalise(key);
    return keymaps.some(b => {
        const k = mac ? (b.mac ?? b.key) : (b.win ?? b.linux ?? b.key);
        if (!k) return false;
        // Mod is Cmd on a Mac and Ctrl elsewhere
        const resolve = (s: string) => normalise(s.replace(/\bMod\b/, mac ? "Cmd" : "Ctrl"));
        return resolve(k) === resolve(wanted);
    });
}

describe("keyboard shortcuts", () => {
    for (const mac of [false, true]) {
        test(`every CodeMirror shortcut listed is bound (${mac ? "Mac" : "Windows and Linux"})`, () => {
            const missing: string[] = [];
            for (const group of SHORTCUT_GROUPS) {
                for (const shortcut of group.shortcuts) {
                    for (const key of (mac && shortcut.mac) || shortcut.keys) {
                        if (!EDITOR_KEYS.has(key) && !bound(key, mac)) missing.push(key);
                    }
                }
            }
            expect(missing).toEqual([]);
        });
    }

    test("keys are named for the platform", () => {
        expect(formatKey("Mod-Shift-o", false)).toBe("Ctrl+Shift+O");
        expect(formatKey("Mod-Shift-o", true)).toBe("⌘⇧O");
        expect(keyNames("Mod-[", false)).toEqual(["Ctrl", "["]);
        expect(keyNames("Shift-Alt-ArrowUp", true)).toEqual(["⇧", "⌥", "↑"]);
        expect(formatKey("F12", true)).toBe("F12");
        expect(formatKey("Mod-click", false)).toBe("Ctrl+Click");
    });
});

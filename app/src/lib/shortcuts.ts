// The keyboard shortcuts the Keyboard shortcuts dialog lists: the editor's own, and the most
// useful of CodeMirror's, which it has but doesn't show anywhere else. Keys are written as
// CodeMirror writes them ("Mod-Shift-o", where Mod is Cmd on a Mac and Ctrl elsewhere), with
// `mac` where a Mac uses different keys. shortcuts.test.ts checks CodeMirror's are still bound.

export interface Shortcut {
    keys: string[];
    // Instead of `keys`, on a Mac
    mac?: string[];
    description: string;
}

export interface ShortcutGroup {
    heading: string;
    shortcuts: Shortcut[];
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// The editor's own, which aren't CodeMirror's
export const EDITOR_KEYS = new Set(["Mod-s", "Mod-Enter", "Mod-Shift-Enter", "Mod-Shift-o", "Mod-Shift-m", "F12", "Mod-click", "Shift-F12", "F2"]);

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
    {
        heading: "Story",
        shortcuts: [
            { keys: ["Mod-s"], description: "Save" },
            { keys: ["Mod-Enter"], description: "Run the story" },
            { keys: ["Mod-Shift-Enter"], description: "Run from the section the cursor is in" },
            { keys: ["Mod-Shift-o"], description: "Go to a section or passage" },
            { keys: ["Mod-Shift-m"], description: "List every problem in the story" },
            { keys: ["F8"], description: "Go to the next problem in this file" },
        ],
    },
    {
        heading: "Sections and passages",
        shortcuts: [
            { keys: ["F12", "Mod-click"], description: "Go to the section or passage a link goes to" },
            { keys: ["Shift-F12"], description: "List every link to a section or passage" },
            { keys: ["F2"], description: "Rename a section or passage everywhere" },
            { keys: ["Ctrl-Space"], mac: ["Ctrl-Space", "Alt-`"], description: "Suggest section, passage and attribute names" },
        ],
    },
    {
        heading: "Editing",
        shortcuts: [
            { keys: ["Mod-z"], description: "Undo" },
            { keys: ["Mod-y"], mac: ["Mod-Shift-z"], description: "Redo" },
            { keys: ["Alt-ArrowUp", "Alt-ArrowDown"], description: "Move the line up or down" },
            { keys: ["Shift-Alt-ArrowUp", "Shift-Alt-ArrowDown"], description: "Copy the line up or down" },
            { keys: ["Shift-Mod-k"], description: "Delete the line" },
            { keys: ["Mod-[", "Mod-]"], description: "Indent less or more" },
            { keys: ["Mod-/"], description: "Comment out, or back in" },
        ],
    },
    {
        heading: "Selecting",
        shortcuts: [
            { keys: ["Alt-l"], mac: ["Ctrl-l"], description: "Select the line" },
            { keys: ["Mod-d"], description: "Select the next match of the selection, as another cursor" },
            { keys: ["Mod-Shift-l"], description: "Select every match of the selection" },
            { keys: ["Mod-Alt-ArrowUp", "Mod-Alt-ArrowDown"], description: "Add a cursor above or below" },
            { keys: ["Escape"], description: "Go back to one cursor" },
        ],
    },
    {
        heading: "Find",
        shortcuts: [
            { keys: ["Mod-f"], description: "Find" },
            { keys: ["Mod-h"], mac: ["Mod-Alt-f"], description: "Find and replace" },
            { keys: ["F3", "Mod-g"], description: "Find the next match (with Shift, the one before)" },
            { keys: ["Mod-Alt-g"], description: "Go to a line" },
        ],
    },
    {
        heading: "Folding",
        shortcuts: [
            { keys: ["Ctrl-Shift-["], mac: ["Cmd-Alt-["], description: "Collapse the section or passage" },
            { keys: ["Ctrl-Shift-]"], mac: ["Cmd-Alt-]"], description: "Expand it" },
            { keys: ["Ctrl-Alt-["], description: "Collapse all" },
            { keys: ["Ctrl-Alt-]"], description: "Expand all" },
        ],
    },
];

const MAC_NAMES: Record<string, string> = { Mod: "⌘", Cmd: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
const NAMES: Record<string, string> = {
    Mod: "Ctrl", Cmd: "Ctrl", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc", click: "Click",
};

// The keys to press, one name for each, e.g. ["Ctrl", "Shift", "O"] or ["⌘", "⇧", "O"]
export function keyNames(key: string, mac = isMac): string[] {
    // "Mod-[" splits into "Mod" and "[", and a key that's itself "-" would end in an empty part
    return key.split(/-(?!$)/).map(part => {
        const name = (mac ? MAC_NAMES[part] : undefined) ?? NAMES[part] ?? part;
        return name.length === 1 ? name.toUpperCase() : name;
    });
}

// As text, e.g. "Ctrl+Shift+O" or "⌘⇧O", for a menu or a tooltip
export function formatKey(key: string, mac = isMac): string {
    return keyNames(key, mac).join(mac ? "" : "+");
}

export function shortcutKeys(shortcut: Shortcut, mac = isMac): string[] {
    return (mac && shortcut.mac) || shortcut.keys;
}

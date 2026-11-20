// Commands on the code editor that the toolbar offers, as the 6.x editor's menus did.
import type { EditorView } from "@codemirror/view";
import { EditorSelection, type ChangeSpec, type EditorState, type TransactionSpec } from "@codemirror/state";
import { foldAll, unfoldAll } from "@codemirror/language";
import { redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import type { DocumentSymbol } from "squiffy-compiler/language-service";
import type { Snippet } from "./snippets.js";

export type EditorCommand = "undo" | "redo" | "find" | "foldAll" | "unfoldAll";

export function runCommand(view: EditorView, command: EditorCommand) {
    const commands = { undo, redo, find: openSearchPanel, foldAll, unfoldAll };
    commands[command](view);
    view.focus();
}

export function insertSnippet(view: EditorView, content: string) {
    view.dispatch(view.state.replaceSelection(content), { scrollIntoView: true });
    view.focus();
}

// A new section or passage, after the section the cursor is in (passages belong to it). With
// text selected, the selection becomes a link to it and its name; otherwise the cursor goes
// between the brackets of an empty header, ready for a name.
export function addSectionOrPassage(view: EditorView, kind: "section" | "passage", symbols: DocumentSymbol[]) {
    view.dispatch(addSectionOrPassageSpec(view.state, kind, symbols));
    view.focus();
}

export function addSectionOrPassageSpec(state: EditorState, kind: "section" | "passage", symbols: DocumentSymbol[]): TransactionSpec {
    const selection = state.selection.main;
    const name = state.sliceDoc(selection.from, selection.to).replace(/[[\]\n]/g, "").trim();
    const [open, close] = kind === "section" ? ["[[", "]]"] : ["[", "]"];
    const cursorLine = state.doc.lineAt(selection.head).number - 1;

    // After the section the cursor's in, or at the end
    const section = symbols.find(s => s.kind !== "title" && s.range.start.line <= cursorLine && cursorLine <= s.range.end.line);
    const endLine = state.doc.line(section ? Math.min(section.range.end.line + 1, state.doc.lines) : state.doc.lines);
    const at = endLine.to;
    // A blank line before the header, and (when there's more after) one before what follows
    const before = endLine.text.trim() ? "\n\n" : "\n";
    const header = `${open}${name}${close}:\n`;
    const after = at < state.doc.length ? "\n" : "";

    const specs: ChangeSpec[] = [{ from: at, insert: before + header + after }];
    if (name) specs.push({ from: selection.from, to: selection.to, insert: `${open}${name}${close}` });
    const changes = state.changes(specs);

    // Where the new header starts once the link is in: the insertion point, mapped to the side
    // before what's inserted there, then past the blank line. The cursor goes on the line under
    // it, or between its brackets.
    const headerStart = changes.mapPos(at, -1) + before.length;
    return {
        changes,
        selection: EditorSelection.cursor(name ? headerStart + header.length : headerStart + open.length),
        scrollIntoView: true,
    };
}

// The author's own snippets ([snippet:name] blocks) in a file, with their text
export function userSnippets(symbols: DocumentSymbol[], text: string): Snippet[] {
    const lines = text.split("\n");
    return symbols.filter(s => s.kind === "snippet").map(s => ({
        name: s.name,
        content: lines.slice(s.range.start.line + 1, s.range.end.line + 1).join("\n").replace(/\s+$/, ""),
    }));
}

// Cut, copy and paste for the editor's right-click menu, which replaces the browser's own. The
// browser may refuse to read the clipboard (Firefox only allows it from its own Paste item), so
// paste returns false then, for the author to be told to press Ctrl/Cmd+V.
export function selectedText(state: EditorState): string {
    return state.selection.ranges.filter(r => !r.empty).map(r => state.sliceDoc(r.from, r.to)).join(state.lineBreak);
}

export async function clipboardCommand(view: EditorView, command: "cut" | "copy" | "paste"): Promise<boolean> {
    view.focus();
    try {
        if (command === "paste") {
            const text = await navigator.clipboard.readText();
            view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true });
            return true;
        }
        const text = selectedText(view.state);
        if (!text) return true;
        await navigator.clipboard.writeText(text);
        if (command === "cut") view.dispatch(view.state.replaceSelection(""), { userEvent: "delete.cut", scrollIntoView: true });
        return true;
    } catch {
        return false;
    }
}

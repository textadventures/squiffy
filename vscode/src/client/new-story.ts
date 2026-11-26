// Squiffy: New Story: a squiffy.json and a starter story.squiffy in a folder, as the editor makes
// a new story (app/src/lib/project.svelte.ts)

import * as vscode from "vscode";
import { formatProjectFile } from "squiffy-compiler";
import { setHasStory } from "./has-story.js";

export const MAIN_FILE = "story.squiffy";
const PROJECT_FILENAME = "squiffy.json";

// The editor's new story (NEW_STORY in app/src/lib/project.svelte.ts, which new-story.test.ts
// checks this matches)
export const NEW_STORY = `@title New Story

Start writing! Each choice is a [[new section]]: put double square brackets around some text to link to a section.

[[new section]]:

Sections can also have passages, which add text without moving the story on. Click this [passage link], and then carry on to the [[next section]].

[passage link]:
@set clicked_passage

This is the text for the passage. The \`@set\` above makes the story remember that you clicked it.

[[next section]]:
@end

{{#if clicked_passage}}
You clicked the passage link, so you see this.
{{else}}
You didn't click the passage link, so you see this instead.
{{/if}}

That's how the story remembers a choice: the \`@set\` in the passage sets an attribute, and the \`#if\`, \`else\` and \`/if\` lines above choose which text to show.

When a new section appears, any passage links in the previous section that weren't clicked are disabled.

This section has no links, so the story ends here. The \`@end\` above says that's on purpose. Without it, the editor would warn you about a dead end.
`;

/** A story's title, tidied: one line, without extra spaces */
const tidyTitle = (title: string) => title.normalize("NFC").replace(/\s+/g, " ").trim();

/** The new story's text, with its title */
export function newStoryText(title: string): string {
    return NEW_STORY.replace(/^@title .*$/m, () => `@title ${tidyTitle(title) || "New Story"}`);
}

/** The new story's files, by name. Its language is VS Code's, which the author is most likely writing in. */
export function newStoryFiles(title: string, language?: string): Record<string, string> {
    return {
        [MAIN_FILE]: newStoryText(title),
        [PROJECT_FILENAME]: formatProjectFile({ main: MAIN_FILE, language }),
    };
}

const exists = async (uri: vscode.Uri) => {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    }
    catch {
        return false;
    }
};

// In a folder, if one's given (from the Explorer's context menu), else one the author picks
export async function newStory(folder?: vscode.Uri) {
    if (!folder) {
        const picked = await vscode.window.showOpenDialog({
            title: "Choose a folder for the new story",
            defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
            canSelectFiles: false,
            canSelectFolders: true,
            openLabel: "Create Story Here",
        });
        folder = picked?.[0];
        if (!folder) return;
    }
    if (await exists(vscode.Uri.joinPath(folder, PROJECT_FILENAME))) {
        void vscode.window.showErrorMessage(`${vscode.workspace.asRelativePath(folder)} already has a story: it has a ${PROJECT_FILENAME}.`);
        return;
    }
    const title = await vscode.window.showInputBox({ title: "New story", prompt: "The story's title", value: "New Story" });
    if (title === undefined) return;
    const main = vscode.Uri.joinPath(folder, MAIN_FILE);
    if (await exists(main)) {
        const replace = await vscode.window.showWarningMessage(`${vscode.workspace.asRelativePath(main)} already exists. Replace it?`, { modal: true }, "Replace");
        if (replace != "Replace") return;
    }
    for (const [name, text] of Object.entries(newStoryFiles(title, vscode.env.language))) {
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, name), new TextEncoder().encode(text));
    }
    await vscode.window.showTextDocument(main);
    // Only now, not when New Story is clicked, as the folder or title may be cancelled (#700)
    setHasStory();
    if (!vscode.workspace.getWorkspaceFolder(main)) {
        void vscode.window.showInformationMessage("The new story isn't in the open folder, so links and problems are only checked in its own folder. Open its folder to work on it.", "Open Folder")
            .then(action => action && vscode.commands.executeCommand("vscode.openFolder", folder));
    }
}

// Whether a passage header put after a line would be in a section. A passage belongs to the
// section above it: one with a header, or the text at the start of the story, before any
// section. Above the first of those, as on an @title line at the top of the file, it would
// have no section, and would take the story's opening text for its own.
export function passageHasSection(lines: string[], afterLine: number): boolean {
    for (let i = Math.min(afterLine, lines.length - 1); i >= 0; i--) {
        const line = lines[i].trim();
        if (/^\[\[.*\]\]:$/.test(line) || /^\+\+\+/.test(line) || /^---/.test(line)) return true;
        // Text, not a directive such as @title: the start of the story
        if (line && !line.startsWith("@") && !/^\[[^[\]]*\]:$/.test(line)) return true;
    }
    return false;
}

// Where Add Section and Add Passage put a header, as the editor does (addSectionOrPassageSpec in
// app/src/lib/editor-commands.ts): after the section the cursor's in, passages and all, or at the
// end of the file. At the cursor, it would take the rest of the section, and its passages, for
// its own. `sections` are the file's sections' line ranges; the header goes at the end of `line`.
export function headerPlace(lines: string[], cursorLine: number, sections: { start: number; end: number }[]) {
    const section = sections.find(s => s.start <= cursorLine && cursorLine <= s.end);
    const line = Math.min(section ? section.end : lines.length - 1, lines.length - 1);
    // A blank line before the header, and (when there's more after) one before what follows
    const before = lines[line].trim() ? "\n\n" : "\n";
    const after = line < lines.length - 1 ? "\n" : "";
    return { line, before, after };
}

// The selected text, as the name of a new section or passage that it becomes a link to
export function selectedName(text: string) {
    return text.replace(/[[\]\r\n]/g, "").trim();
}

// Add Section and Add Passage: a header after the cursor's section. With text selected, the
// selection becomes a link to it and its name; otherwise the header is a snippet to type a name into.
export async function insertHeader(editor: vscode.TextEditor, kind: "section" | "passage") {
    const { document, selection } = editor;
    const lines = document.getText().split(/\r?\n/);
    if (kind == "passage" && !passageHasSection(lines, selection.active.line)) {
        void vscode.window.showInformationMessage("A passage belongs to a section, and there's no section here yet. Put the cursor in a section's text, or add a section first with Squiffy: Add Section.");
        return;
    }
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>("vscode.executeDocumentSymbolProvider", document.uri) ?? [];
    const sections = symbols.filter(s => s.kind == vscode.SymbolKind.Class).map(s => ({ start: s.range.start.line, end: s.range.end.line }));
    const place = headerPlace(lines, selection.active.line, sections);
    const at = document.lineAt(place.line).range.end;
    const [open, close] = kind == "section" ? ["[[", "]]"] : ["[", "]"];
    const name = selectedName(document.getText(selection));

    if (!name) {
        const header = kind == "section" ? "[[${1:section name}]]:\n$0" : "[${1:passage name}]:\n$0";
        return editor.insertSnippet(new vscode.SnippetString(place.before + header + place.after), at);
    }
    // The link and the header in one edit, so one Undo takes both away; then the cursor goes on
    // the line under the header, ready for its text
    const link = `${open}${name}${close}`;
    const header = `${link}:\n`;
    const atOffset = document.offsetAt(at);
    const shift = document.offsetAt(selection.end) <= atOffset ? link.length - document.getText(selection).length : 0;
    const done = await editor.edit(edit => {
        edit.replace(selection, link);
        edit.insert(at, place.before + header + place.after);
    });
    if (!done) return;
    const cursor = editor.document.positionAt(atOffset + shift + place.before.length + header.length);
    editor.selection = new vscode.Selection(cursor, cursor);
    editor.revealRange(new vscode.Range(cursor, cursor));
}

// Squiffy: New Story: a squiffy.json and a starter story.squiffy in a folder, as the editor makes
// a new story (app/src/lib/project.svelte.ts)

import * as vscode from "vscode";
import { formatProjectFile } from "squiffy-compiler";

export const MAIN_FILE = "story.squiffy";
const PROJECT_FILENAME = "squiffy.json";

// The editor's new story (NEW_STORY in app/src/lib/project.svelte.ts, which new-story.test.ts
// checks this matches)
export const NEW_STORY = `@title New Story

Start writing! Each choice is a [[new section]]: put double square brackets around some text to link to a section.

[[new section]]:

Sections can also have passages, which add text without moving the story on. Click this [passage link], and then carry on to the [[next section]].

[passage link]:

This is the text for the passage.

[[next section]]:
@end

When a new section appears, any passage links in the previous section that weren't clicked are disabled.

This section has no links, so the story ends here. The @end above says that's on purpose. Without it, the editor would warn you about a dead end.
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

// Add Section and Add Passage: a header at the cursor, as a snippet to type its name into. On a
// line with text, it goes after that line. Either way, it's kept a blank line from the text around.
export function insertHeader(editor: vscode.TextEditor, kind: "section" | "passage") {
    const header = kind == "section" ? "[[${1:section name}]]:\n$0" : "[${1:passage name}]:\n$0";
    const { document, selection } = editor;
    const line = document.lineAt(selection.active.line);
    if (kind == "passage" && !passageHasSection(document.getText().split(/\r?\n/), line.lineNumber)) {
        void vscode.window.showInformationMessage("A passage belongs to a section, and there's no section here yet. Put the cursor in a section's text, or add a section first with Squiffy: Add Section.");
        return;
    }
    const hasText = (lineNumber: number) => lineNumber >= 0 && lineNumber < document.lineCount && !document.lineAt(lineNumber).isEmptyOrWhitespace;
    const after = hasText(line.lineNumber + 1) ? "\n" : "";
    if (line.isEmptyOrWhitespace) {
        const before = hasText(line.lineNumber - 1) ? "\n" : "";
        return editor.insertSnippet(new vscode.SnippetString(before + header + after), line.range);
    }
    return editor.insertSnippet(new vscode.SnippetString("\n\n" + header + after), line.range.end);
}

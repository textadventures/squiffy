// Connects a CodeMirror editor to the language service worker:
//   - diagnostics as lint markers, with quick fixes (e.g. creating a missing section, #173)
//   - the document outline, and folding ranges
//   - completion of section, passage, attribute and snippet names
//   - hover previews of the section or passage a link goes to
//   - go to definition (F12, or Ctrl/Cmd+click), find references (Shift+F12) and rename (F2)
//   - a bar at the cursor offering to go where a link goes, or to fix a problem (cursor-bar.ts)
// Things that need the app's UI (moving to another file, showing references, asking for a name)
// go through the callbacks in LanguageFeatureOptions. The editor's right-click menu runs the same
// commands, which it finds in the languageCommands facet.
import { Facet, StateEffect, StateField, Text, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, keymap, type Command } from "@codemirror/view";
import { foldService } from "@codemirror/language";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { forceLinting, linter, lintGutter, type Action, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import type {
    CodeAction, CompletionItem, DocumentSymbol, FoldingRange, Location, Position, TextEdit, WorkspaceEdit,
} from "squiffy-compiler/language-service";
import { squiffyLanguage } from "@textadventures/squiffy-codemirror";
import { refreshFolding } from "../codemirror-folding.js";
import { diagnosticKey, fixesByDiagnostic } from "../problems.js";
import { isMac } from "../shortcuts.js";
import type { LanguageClient } from "./client.js";
import { cursorBar } from "./cursor-bar.js";

const DELAY_MS = 300;

// A language service position (zero-based line and UTF-16 character) as a document offset
export function toOffset(doc: Text, position: Position): number {
    if (position.line >= doc.lines) return doc.length;
    const line = doc.line(position.line + 1);
    return Math.min(line.from + position.character, line.to);
}

export function toPosition(doc: Text, offset: number): Position {
    const line = doc.lineAt(offset);
    return { line: line.number - 1, character: offset - line.from };
}

// Applies text edits to the editor as one change, so it's one step to undo. The edits' positions
// are in `doc`, which must still be the editor's text.
export function applyTextEdits(view: EditorView, edits: TextEdit[], doc: Text = view.state.doc) {
    view.dispatch({
        changes: edits.map(e => ({
            from: toOffset(doc, e.range.start),
            to: toOffset(doc, e.range.end),
            insert: e.newText,
        })),
        userEvent: "input.complete",
    });
}

export interface LanguageFeatureOptions {
    client: LanguageClient;
    path: string;
    // Called with the outline after each analysis that's still current
    onSymbols?(symbols: DocumentSymbol[]): void;
    // Go to a location in another file. Locations in this file are handled here.
    onNavigate?(location: Location): void;
    // Asked before going to a location in this file: return true if the app goes there itself,
    // e.g. while the editor shows only one section, and the location's in another
    takeNavigation?(location: Location): boolean;
    // Show where a section or passage is used
    onReferences?(name: string, locations: Location[]): void;
    // Ask for a new name, or null to cancel
    prompt(message: string, initial: string): Promise<string | null>;
    // Apply edits to files other than this one, e.g. from a rename
    applyEdits?(edit: WorkspaceEdit): Promise<void>;
    // Tell the author something, e.g. why a rename isn't possible
    notify(message: string): void;
    // Add the section or passage a broken link in this file points to, where the app chooses
    // (e.g. where the story map would). Without this, a quick fix adds it at the end.
    onCreate?(fix: CodeAction): void;
}

// The commands for the section or passage at the cursor, for the right-click menu
export interface LanguageCommands {
    definition: Command;
    references: Command;
    rename: Command;
    // Whether there's a section or passage at an offset, for these commands to act on
    hasDefinition(view: EditorView, offset: number): Promise<boolean>;
}

export const languageCommands = Facet.define<LanguageCommands, LanguageCommands | undefined>({
    combine: values => values[0],
});

const COMPLETION_TYPES: Record<CompletionItem["kind"], string> = {
    section: "class",
    passage: "property",
    attribute: "variable",
    snippet: "text",
    directive: "keyword",
};

// Folding ranges from the last analysis, as document offsets, kept in step with edits
const setFoldRanges = StateEffect.define<{ from: number; to: number }[]>();

// Checks a file for problems again although its text hasn't changed, e.g. after another file
// changed. CodeMirror's forceLinting only hurries a check that's already due.
const recheck = StateEffect.define<null>();

export function recheckProblems(view: EditorView) {
    view.dispatch({ effects: recheck.of(null) });
}

const foldRanges = StateField.define<{ from: number; to: number }[]>({
    create: () => [],
    update(ranges, tr) {
        for (const e of tr.effects) if (e.is(setFoldRanges)) return e.value;
        if (!tr.docChanged) return ranges;
        return ranges.map(r => ({ from: tr.changes.mapPos(r.from, 1), to: tr.changes.mapPos(r.to, -1) }));
    },
});

function toFoldOffsets(doc: Text, ranges: FoldingRange[]) {
    return ranges
        .filter(r => r.endLine < doc.lines)
        .map(r => ({ from: doc.line(r.startLine + 1).to, to: doc.line(r.endLine + 1).to }));
}

const squiffyFolding = foldService.of((state: EditorState, lineStart: number, lineEnd: number) => {
    const range = state.field(foldRanges, false)?.find(r => r.from === lineEnd);
    return range && range.to > range.from && range.from >= lineStart ? range : null;
});

// The hover's text: the service sends a bold heading, then the first lines of the passage or
// section as written. Shown as plain text, so nothing in a story is ever parsed as HTML.
function hoverContent(markdown: string): HTMLElement {
    const dom = document.createElement("div");
    dom.className = "cm-squiffy-hover";
    const [first, ...rest] = markdown.split("\n\n");
    const heading = document.createElement("div");
    heading.className = "cm-squiffy-hover-heading";
    heading.textContent = first.replace(/^\*\*(.*)\*\*$/, "$1");
    dom.appendChild(heading);
    if (rest.length) {
        const body = document.createElement("div");
        body.className = "cm-squiffy-hover-body";
        body.textContent = rest.join("\n\n");
        dom.appendChild(body);
    }
    return dom;
}

const hoverTheme = EditorView.baseTheme({
    ".cm-squiffy-hover": { padding: "0.35rem 0.6rem", maxWidth: "28rem", fontSize: "var(--text-xs)" },
    ".cm-squiffy-hover-heading": { fontWeight: "600", marginBottom: "0.2rem" },
    ".cm-squiffy-hover-body": { whiteSpace: "pre-wrap", opacity: "0.8" },
});

export function languageFeatures(options: LanguageFeatureOptions): Extension[] {
    const { client, path } = options;

    // The text the worker last had for this file. Every query sends the current text first if it
    // has changed; the worker handles messages in order, so the query sees it.
    let synced: Text | undefined;
    async function sync(doc: Text) {
        if (doc === synced) return;
        synced = doc;
        await client.call("updateFile", path, doc.toString());
    }

    // Moves the cursor to a location in this file, or asks the app to open another file
    function navigate(view: EditorView, location: Location) {
        if (location.file !== path) {
            options.onNavigate?.(location);
            return;
        }
        if (options.takeNavigation?.(location)) return;
        const anchor = toOffset(view.state.doc, location.range.start);
        const head = toOffset(view.state.doc, location.range.end);
        view.dispatch({
            selection: { anchor, head },
            effects: EditorView.scrollIntoView(anchor, { y: "center" }),
        });
        view.focus();
    }

    async function goToDefinition(view: EditorView, offset: number) {
        const doc = view.state.doc;
        await sync(doc);
        const location = await client.call("getDefinition", path, toPosition(doc, offset));
        if (location) navigate(view, location);
    }

    const definitionCommand: Command = view => {
        void goToDefinition(view, view.state.selection.main.head);
        return true;
    };

    const referencesCommand: Command = view => {
        void (async () => {
            const doc = view.state.doc;
            const position = toPosition(doc, view.state.selection.main.head);
            await sync(doc);
            const [definition, locations] = await Promise.all([
                client.call("getDefinition", path, position),
                client.call("getReferences", path, position, false),
            ]);
            if (!definition) {
                options.notify("Put the cursor on a section or passage name, or a link to one.");
                return;
            }
            const name = definition.file === path ? doc.sliceString(toOffset(doc, definition.range.start), toOffset(doc, definition.range.end)) : "";
            options.onReferences?.(name, locations);
        })();
        return true;
    };

    const renameCommand: Command = view => {
        void (async () => {
            const doc = view.state.doc;
            const position = toPosition(doc, view.state.selection.main.head);
            await sync(doc);
            const target = await client.call("getRenameTarget", path, position);
            if (!target) {
                options.notify("Put the cursor on a section or passage name, or a link to one, to rename it.");
                return;
            }
            const current = target.name;
            const newName = await options.prompt("Rename to:", current);
            if (newName === null || newName === current) return;
            if (view.state.doc !== doc) {
                options.notify("The story changed while renaming. Try again.");
                return;
            }
            const result = await client.call("getRenameEdits", path, position, newName);
            if (!result) return;
            if ("error" in result) {
                options.notify(result.error);
                return;
            }
            const { [path]: here = [], ...elsewhere } = result.edit;
            if (here.length) applyTextEdits(view, here, doc);
            if (Object.keys(elsewhere).length) await options.applyEdits?.(elsewhere);
        })();
        return true;
    };

    async function hasDefinition(view: EditorView, offset: number) {
        const doc = view.state.doc;
        await sync(doc);
        return (await client.call("getDefinition", path, toPosition(doc, offset))) !== undefined;
    }

    async function complete(context: CompletionContext): Promise<CompletionResult | null> {
        const doc = context.state.doc;
        await sync(doc);
        const items = await client.call("getCompletions", path, toPosition(doc, context.pos));
        if (context.aborted || items.length === 0) return null;
        // Snippets are offered at the start of any line, so only when asked for (Ctrl+Space) or
        // once a word's begun, rather than on every new line
        const onlySnippets = items.every(i => i.kind === "snippet");
        if (onlySnippets && !context.explicit && !context.matchBefore(/\w+$/)) return null;
        return {
            from: toOffset(doc, items[0].range.start),
            options: items.map(item => ({
                label: item.label,
                type: COMPLETION_TYPES[item.kind],
                detail: item.detail ?? item.kind,
                apply: item.insertText ?? item.label,
            })),
            validFor: /^[^[\]()\n,"']*$/,
        };
    }

    // Quick fixes, as lint actions on the diagnostics they fix. `doc` is the text they were made
    // for; if the author has typed since, the fix waits for the next analysis.
    function toActions(actions: CodeAction[], doc: Text): Map<string, Action[]> {
        return fixesByDiagnostic(actions, a => lintAction(a, doc));
    }

    // The fixes to offer at the cursor (CodeAction.isPreferred)
    const preferred = new WeakSet<Action>();

    function lintAction(action: CodeAction, doc: Text): Action {
        const lint: Action = {
            name: action.title,
            apply(view) {
                if (view.state.doc !== doc) {
                    forceLinting(view);
                    return;
                }
                if (action.create && options.onCreate) {
                    options.onCreate(action);
                    return;
                }
                applyTextEdits(view, action.edit[path] ?? [], doc);
            },
        };
        if (action.isPreferred) preferred.add(lint);
        return lint;
    }

    // What the link at an offset goes to, as its hover names it
    async function linkAt(view: EditorView, offset: number): Promise<string | undefined> {
        const doc = view.state.doc;
        await sync(doc);
        const hover = await client.call("getHover", path, toPosition(doc, offset));
        return hover?.contents.split("\n\n")[0].replace(/^\*\*(.*)\*\*$/, "$1");
    }

    return [
        linter(async view => {
            const doc = view.state.doc;
            await sync(doc);
            const whole = { start: { line: 0, character: 0 }, end: toPosition(doc, doc.length) };
            const [diagnostics, symbols, folding, actions] = await Promise.all([
                client.call("getDiagnostics", path),
                client.call("getDocumentSymbols", path),
                client.call("getFoldingRanges", path),
                client.call("getCodeActions", path, whole),
            ]);
            // CodeMirror drops the diagnostics itself if the text changed meanwhile
            if (view.state.doc === doc) {
                options.onSymbols?.(symbols);
                view.dispatch({ effects: [setFoldRanges.of(toFoldOffsets(doc, folding)), refreshFolding.of(null)] });
            }
            const fixes = toActions(actions, doc);
            return diagnostics.map((d): CmDiagnostic => ({
                from: toOffset(doc, d.range.start),
                to: toOffset(doc, d.range.end),
                severity: d.severity,
                message: d.message,
                source: d.code,
                actions: fixes.get(diagnosticKey(d)),
            }));
        }, {
            delay: DELAY_MS,
            needsRefresh: update => update.transactions.some(tr => tr.effects.some(e => e.is(recheck))),
        }),
        lintGutter(),
        foldRanges,
        squiffyFolding,
        squiffyLanguage.data.of({ autocomplete: complete }),
        hoverTooltip(async (view, pos) => {
            const doc = view.state.doc;
            await sync(doc);
            const hover = await client.call("getHover", path, toPosition(doc, pos));
            if (!hover || view.state.doc !== doc) return null;
            return {
                pos: toOffset(doc, hover.range.start),
                end: toOffset(doc, hover.range.end),
                above: true,
                create: () => ({ dom: hoverContent(hover.contents) }),
            };
        }),
        hoverTheme,
        cursorBar({ linkAt, goTo: (view, offset) => void goToDefinition(view, offset), isPreferred: a => preferred.has(a) }),
        languageCommands.of({ definition: definitionCommand, references: referencesCommand, rename: renameCommand, hasDefinition }),
        keymap.of([
            { key: "F12", run: definitionCommand, preventDefault: true },
            { key: "Shift-F12", run: referencesCommand, preventDefault: true },
            { key: "F2", run: renameCommand, preventDefault: true },
        ]),
        EditorView.domEventHandlers({
            mousedown(event, view) {
                // Cmd on a Mac, where Ctrl+click is a right-click
                if (!(isMac ? event.metaKey : event.ctrlKey) || event.button !== 0) return false;
                const offset = view.posAtCoords({ x: event.clientX, y: event.clientY });
                if (offset === null) return false;
                event.preventDefault();
                void goToDefinition(view, offset);
                return true;
            },
        }),
    ];
}

// Applies text edits to a file's text, e.g. one that isn't open in the editor. Keeps the file's
// line endings.
export function applyEditsToString(text: string, edits: TextEdit[]): string {
    const doc = Text.of(text.split(/\r?\n/));
    const changes = edits
        .map(e => ({ from: toOffset(doc, e.range.start), to: toOffset(doc, e.range.end), insert: e.newText }))
        .sort((a, b) => b.from - a.from);
    let result = doc.toString();
    for (const c of changes) result = result.slice(0, c.from) + c.insert + result.slice(c.to);
    return text.includes("\r\n") ? result.replace(/\r?\n/g, "\r\n") : result;
}

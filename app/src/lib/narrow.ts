// Narrowing: showing only part of a document in its editor, for writing one section from the
// story map (#542). The rest is hidden, not removed, so it's the same document with the same undo
// history, completion and problems as the script. The cursor and the author's edits are kept
// inside the part that's shown; changes from elsewhere (a rename, a link added from the map, undo)
// go through as usual.
import { EditorState, StateEffect, StateField, Transaction, type Extension, type Range, type TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";

export interface Narrowed {
    // Whole lines: `from` is the start of a line, and `to` the end of one
    from: number;
    to: number;
}

// Narrows to a range, or shows the whole document again (null)
export const setNarrow = StateEffect.define<Narrowed | null>();

const narrowField = StateField.define<Narrowed | null>({
    create: () => null,
    update(value, tr) {
        for (const effect of tr.effects) if (effect.is(setNarrow)) return effect.value;
        if (!value || !tr.docChanged) return value;
        // Text added at either end is part of what's shown
        const from = tr.changes.mapPos(value.from, -1);
        return { from, to: Math.max(from, tr.changes.mapPos(value.to, 1)) };
    },
    provide: field => [
        EditorView.decorations.compute([field, "doc"], state => hidden(state.field(field), state)),
        EditorView.atomicRanges.of(view => hidden(view.state.field(field), view.state)),
    ],
});

export const narrowed = (state: EditorState): Narrowed | null => state.field(narrowField, false) ?? null;

const hide = Decoration.replace({ block: true });

// Everything outside the range, as whole lines
function hidden(value: Narrowed | null, state: EditorState): DecorationSet {
    if (!value) return Decoration.none;
    const length = state.doc.length;
    const ranges: Range<Decoration>[] = [];
    if (value.from > 0) ranges.push(hide.range(0, value.from - 1));
    if (value.to < length) ranges.push(hide.range(value.to + 1, length));
    return Decoration.set(ranges);
}

// The author's own edits, which stay inside what's shown. Completions always are, and undo and
// redo may be of changes made elsewhere.
function byAuthor(tr: Transaction) {
    const event = tr.annotation(Transaction.userEvent);
    return !!event && !/^(undo|redo|input\.complete|reload)/.test(event);
}

const keepInside = EditorState.transactionFilter.of(tr => {
    const value = tr.startState.field(narrowField);
    if (!value || tr.effects.some(e => e.is(setNarrow))) return tr;
    if (tr.docChanged && byAuthor(tr)) {
        // Backspace at the start would join the text to the header above, and Delete at the end
        // would pull the next section up
        let outside = false;
        tr.changes.iterChangedRanges((fromA, toA) => {
            if (fromA < value.from || toA > value.to) outside = true;
        });
        if (outside) return [];
    }
    const specs: TransactionSpec[] = [tr];
    let { from, to } = value;
    if (tr.docChanged) {
        from = tr.changes.mapPos(value.from, -1);
        to = Math.max(from, tr.changes.mapPos(value.to, 1));
        // A blank line between this and whatever comes next, so the text the author adds at the
        // end isn't run into the next header
        if (byAuthor(tr) && to < tr.newDoc.length) {
            const next = tr.newDoc.lineAt(to + 1);
            if (next.text.trim()) specs.push({ changes: { from: to, insert: "\n" }, effects: setNarrow.of({ from, to }), sequential: true });
        }
    }
    // The cursor stays in what's shown (so Select All selects the section)
    if (tr.selection || tr.docChanged) {
        const selection = tr.newSelection;
        if (selection.ranges.some(r => r.from < from || r.to > to)) {
            const clamp = (n: number) => Math.min(Math.max(n, from), to);
            specs.push({
                selection: { anchor: clamp(selection.main.anchor), head: clamp(selection.main.head) },
                sequential: true,
            });
        }
    }
    return specs.length > 1 ? specs : tr;
});

// The extension, for every editor that might be narrowed. `onEscape` is called when Escape is
// pressed in a narrowed editor and nothing else (a completion list, the Find panel) takes it.
export function narrowing(onEscape?: (view: EditorView) => void): Extension {
    return [
        narrowField,
        keepInside,
        keymap.of([{
            key: "Escape",
            run: view => {
                if (!narrowed(view.state) || !onEscape) return false;
                onEscape(view);
                return true;
            },
        }]),
    ];
}

// The part of a document for a section or passage: the lines after its header (or from its
// first line, if `withHeader`, for a section whose header is its text, such as "+++Continue"),
// up to its last line with anything on it. `startLine` and `endLine` are its first and last lines,
// counted from 0. Undefined if the header is the document's last line, with nowhere to write
// after it: add a line break first.
export function narrowRange(state: EditorState, startLine: number, endLine: number, withHeader: boolean): Narrowed | undefined {
    const doc = state.doc;
    const first = Math.min(startLine + (withHeader ? 0 : 1) + 1, doc.lines + 1);
    if (first > doc.lines) return undefined;
    const from = doc.line(first).from;
    let last = Math.min(endLine + 1, doc.lines);
    while (last > first && !doc.line(last).text.trim()) last--;
    return { from, to: Math.max(from, doc.line(Math.max(last, first)).to) };
}

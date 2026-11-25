// Highlights what the story map's (and the outline's) search finds, in the script (#679), so a
// section opened from a match shows where its text matched. Like Find's matches, but without its
// panel: case-insensitive plain text, coloured as .cm-searchMatch.
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

// The text to highlight, or "" for none
export const setSearchHighlight = StateEffect.define<string>();

const mark = Decoration.mark({ class: "cm-searchMatch" });

// Where `term` is in the document, from `from` on, case-insensitively
export function findMatch(state: EditorState, term: string, from = 0, to = state.doc.length): { from: number; to: number } | null {
    const q = term.trim().toLowerCase();
    if (!q) return null;
    const at = state.sliceDoc(from, to).toLowerCase().indexOf(q);
    return at < 0 ? null : { from: from + at, to: from + at + q.length };
}

// `initial` gives the search when the editor is made; setSearchHighlight changes it after that
export function searchHighlight(initial: () => string): Extension {
    const term = StateField.define<string>({
        create: () => initial().trim().toLowerCase(),
        update(value, tr) {
            for (const effect of tr.effects) if (effect.is(setSearchHighlight)) return effect.value.trim().toLowerCase();
            return value;
        },
    });

    // Only what's on screen, so a long file stays quick
    function decorate(view: EditorView): DecorationSet {
        const q = view.state.field(term);
        if (!q) return Decoration.none;
        const marks = [];
        for (const { from, to } of view.visibleRanges) {
            // A little either side, for a match that straddles the edge
            const start = Math.max(0, from - q.length);
            const text = view.state.sliceDoc(start, Math.min(view.state.doc.length, to + q.length)).toLowerCase();
            for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) {
                const at = start + i;
                if (at + q.length > from && at < to && (!marks.length || at >= marks[marks.length - 1].to)) {
                    marks.push(mark.range(at, at + q.length));
                }
            }
        }
        return Decoration.set(marks);
    }

    const plugin = ViewPlugin.fromClass(class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
            this.decorations = decorate(view);
        }
        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged || update.startState.field(term) !== update.state.field(term)) {
                this.decorations = decorate(update.view);
            }
        }
    }, { decorations: v => v.decorations });

    return [term, plugin];
}

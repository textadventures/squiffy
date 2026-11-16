// Folding ranges that come from outside the editor's own syntax tree, such as the language
// service's. CodeMirror's fold gutter only redraws when the document, viewport, language or fold
// state changes, so a source that finds new ranges later dispatches refreshFolding to redraw it.
import { StateEffect } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";

export const refreshFolding = StateEffect.define<null>();

export function foldingChanged(update: ViewUpdate): boolean {
    return update.transactions.some(tr => tr.effects.some(e => e.is(refreshFolding)));
}

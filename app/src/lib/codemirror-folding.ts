// Folding ranges that come from outside the editor's own syntax tree, such as the language
// service's. CodeMirror's fold gutter only redraws when the document, viewport, language or fold
// state changes, so a source that finds new ranges later dispatches refreshFolding to redraw it.
import { StateEffect } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";

export const refreshFolding = StateEffect.define<null>();

export function foldingChanged(update: ViewUpdate): boolean {
    return update.transactions.some(tr => tr.effects.some(e => e.is(refreshFolding)));
}

// The fold gutter's markers. CodeMirror's default ⌄ and › are text, and the two glyphs sit at
// different heights, so the open one looked too low. These are Lucide's chevron-down and
// chevron-right, centred on the first line of the block.
const svgNs = "http://www.w3.org/2000/svg";

export function foldMarker(open: boolean): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-foldMarker";
    span.title = open ? "Fold" : "Unfold";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", open ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6");
    svg.appendChild(path);
    span.appendChild(svg);
    return span;
}

// The bar at the cursor (#677): when the cursor's in a link, or on a problem with a fix, a small
// bar under it offers to go where the link goes (F12), or to make the fix (Ctrl/Cmd+.), such as
// adding the section a broken link points to. It's a tooltip that follows the cursor, so the text
// never moves. It waits until the problems have been checked again after typing, so it doesn't
// flicker or offer a fix that's out of date, and it's hidden while text is selected or the
// completion list is open.
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap, showTooltip, type Command, type Tooltip, type ViewUpdate } from "@codemirror/view";
import { completionStatus } from "@codemirror/autocomplete";
import { forEachDiagnostic, setDiagnosticsEffect, type Action, type Diagnostic } from "@codemirror/lint";
import { formatKey } from "../shortcuts.js";

export const QUICK_FIX_KEY = "Mod-.";

// How long the cursor has to stay put before the bar's worked out, so it doesn't flash up for
// every line an arrow key passes
const SETTLE_MS = 120;

export interface CursorBarOptions {
    // What a link at an offset goes to, as the bar shows it (e.g. "[[the cellar]]"), or nothing
    // if there's no link there, or it goes nowhere
    linkAt(view: EditorView, offset: number): Promise<string | undefined>;
    goTo(view: EditorView, offset: number): void;
    // Whether a fix is one to offer at the cursor (see CodeAction.isPreferred)
    isPreferred(action: Action): boolean;
}

export interface CursorFix {
    action: Action;
    from: number;
    to: number;
}

interface Bar {
    pos: number;
    goTo?: string;
    fix?: CursorFix;
}

const SEVERITY = { error: 0, warning: 1, info: 2, hint: 3 };

// The fix to offer at a position: the preferred fix of the most serious problem there, and of
// the narrowest of those, as it's the one most likely to be about what's at the cursor
export function fixAt(diagnostics: readonly { diagnostic: Diagnostic; from: number; to: number }[], pos: number,
    isPreferred: (action: Action) => boolean): CursorFix | undefined {
    let best: { from: number; to: number; severity: number; action: Action } | undefined;
    for (const { diagnostic, from, to } of diagnostics) {
        if (pos < from || pos > to) continue;
        const action = diagnostic.actions?.find(isPreferred);
        if (!action) continue;
        const severity = SEVERITY[diagnostic.severity];
        if (!best || severity < best.severity || (severity === best.severity && to - from < best.to - best.from)) {
            best = { from, to, severity, action };
        }
    }
    return best && { action: best.action, from: best.from, to: best.to };
}

function diagnosticsOf(state: EditorState) {
    const found: { diagnostic: Diagnostic; from: number; to: number }[] = [];
    forEachDiagnostic(state, (diagnostic, from, to) => found.push({ diagnostic, from, to }));
    return found;
}

const sameBar = (a: Bar | null, b: Bar | null) => a?.pos === b?.pos && a?.goTo === b?.goTo
    && a?.fix?.action === b?.fix?.action;

function key(text: string) {
    const kbd = document.createElement("kbd");
    kbd.textContent = text;
    return kbd;
}

export function cursorBar(options: CursorBarOptions): Extension {
    const setBar = StateEffect.define<Bar | null>();

    function button(label: string, shortcut: string, run: () => void) {
        const b = document.createElement("button");
        b.type = "button";
        // The editor keeps the focus: the keyboard's way to these is their shortcuts
        b.tabIndex = -1;
        b.append(label, key(shortcut));
        b.addEventListener("mousedown", e => e.preventDefault());
        b.addEventListener("click", run);
        return b;
    }

    function tooltip(bar: Bar): Tooltip {
        return {
            pos: bar.pos,
            above: false,
            create(view) {
                const dom = document.createElement("div");
                dom.className = "cm-squiffy-bar";
                if (bar.goTo) dom.append(button(`Go to ${bar.goTo}`, formatKey("F12"), () => options.goTo(view, bar.pos)));
                if (bar.fix) {
                    const { action, from, to } = bar.fix;
                    dom.append(button(action.name, formatKey(QUICK_FIX_KEY), () => action.apply(view, from, to)));
                }
                return { dom };
            },
        };
    }

    const barField = StateField.define<Bar | null>({
        create: () => null,
        update(bar, tr) {
            for (const e of tr.effects) if (e.is(setBar)) return e.value;
            if (bar && (tr.docChanged || (tr.selection && !(tr.selection.main.empty && tr.selection.main.head === bar.pos)))) return null;
            return bar;
        },
        provide: f => showTooltip.from(f, bar => bar && tooltip(bar)),
    });

    const plugin = ViewPlugin.fromClass(class {
        // Whether the problems are the ones found for the text as it is
        ready = false;
        timer: ReturnType<typeof setTimeout> | undefined;
        request = 0;

        constructor(readonly view: EditorView) {}

        update(update: ViewUpdate) {
            let checked = false;
            for (const tr of update.transactions) {
                if (tr.docChanged) this.ready = false;
                if (tr.effects.some(e => e.is(setDiagnosticsEffect))) this.ready = checked = true;
            }
            if (update.docChanged || update.selectionSet || update.focusChanged || checked
                || completionStatus(update.startState) !== completionStatus(update.state)) this.schedule();
        }

        schedule() {
            clearTimeout(this.timer);
            this.request++;
            this.timer = setTimeout(() => void this.refresh(), SETTLE_MS);
        }

        async refresh() {
            const { view } = this;
            const request = ++this.request;
            const state = view.state;
            const selection = state.selection.main;
            const current = state.field(barField);
            if (!this.ready || !view.hasFocus || !selection.empty || completionStatus(state) !== null) {
                if (current) view.dispatch({ effects: setBar.of(null) });
                return;
            }
            const pos = selection.head;
            const fix = fixAt(diagnosticsOf(state), pos, options.isPreferred);
            const goTo = await options.linkAt(view, pos);
            if (request !== this.request || view.state.doc !== state.doc || view.state.selection.main.head !== pos) return;
            const bar = goTo || fix ? { pos, goTo, fix } : null;
            if (!sameBar(view.state.field(barField), bar)) view.dispatch({ effects: setBar.of(bar) });
        }

        destroy() {
            clearTimeout(this.timer);
            this.request++;
        }
    });

    // Makes the fix at the cursor, whether or not the bar's showing yet
    const quickFix: Command = view => {
        const head = view.state.selection.main.head;
        const fix = view.state.field(barField)?.fix ?? fixAt(diagnosticsOf(view.state), head, options.isPreferred);
        if (!fix) return false;
        fix.action.apply(view, fix.from, fix.to);
        return true;
    };

    return [
        barField,
        plugin,
        keymap.of([{ key: QUICK_FIX_KEY, run: quickFix, preventDefault: true }]),
        barTheme,
    ];
}

const barTheme = EditorView.baseTheme({
    ".cm-tooltip.cm-tooltip-below:has(> .cm-squiffy-bar)": { marginTop: "0.25rem" },
    ".cm-squiffy-bar": { display: "flex", gap: "0.15rem", padding: "0.15rem", fontSize: "var(--text-xs)" },
    ".cm-squiffy-bar button": {
        display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.15rem 0.45rem",
        border: "none", borderRadius: "0.25rem", background: "transparent", color: "inherit", cursor: "pointer",
        font: "inherit",
    },
    ".cm-squiffy-bar button:hover": { background: "color-mix(in oklab, currentColor 12%, transparent)" },
    ".cm-squiffy-bar kbd": { fontFamily: "inherit", opacity: "0.65" },
});

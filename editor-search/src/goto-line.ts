// A Go to line bar, in place of @codemirror/search's gotoLine dialog.
import { EditorSelection, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { EditorView, showPanel, type Command, type Panel } from "@codemirror/view";
import { el, iconButton, ICONS } from "./dom.js";

// Where a line the author typed is, or null if it isn't one:
//   12      line 12
//   12:5    line 12, column 5
//   +3, -3  three lines down or up from the cursor
//   50%     halfway through the document
// A line or column past the end goes to the end.
export function parseLineTarget(state: EditorState, input: string): number | null {
    const match = /^([+-])?(\d+)(?::(\d+))?(%)?$/.exec(input.trim());
    if (!match) return null;
    const [, sign, digits, column, percent] = match;
    const { doc } = state;
    const current = doc.lineAt(state.selection.main.head).number;
    const direction = sign === "-" ? -1 : 1;
    let line = Number(digits);
    if (percent) {
        const fraction = line / 100;
        line = Math.round(doc.lines * (sign ? current / doc.lines + direction * fraction : fraction));
    } else if (sign) {
        line = current + direction * line;
    }
    const target = doc.line(Math.max(1, Math.min(doc.lines, line)));
    const offset = column ? Math.max(0, Math.min(Number(column) - 1, target.length)) : 0;
    return target.from + offset;
}

const toggleGotoLine = StateEffect.define<boolean>();

export const gotoLineState = StateField.define<boolean>({
    create: () => false,
    update(value, tr) {
        for (const effect of tr.effects) if (effect.is(toggleGotoLine)) value = effect.value;
        return value;
    },
    provide: field => showPanel.from(field, open => (open ? createPanel : null)),
});

function createPanel(view: EditorView): Panel {
    return new GotoLinePanel(view);
}

export const openGotoLine: Command = view => {
    if (view.state.field(gotoLineState, false) === undefined) return false;
    if (view.state.field(gotoLineState)) {
        view.dom.querySelector<HTMLInputElement>(".ed-goto input")?.select();
    } else {
        view.dispatch({ effects: toggleGotoLine.of(true) });
    }
    return true;
};

export const closeGotoLine: Command = view => {
    if (!view.state.field(gotoLineState, false)) return false;
    view.dispatch({ effects: toggleGotoLine.of(false) });
    view.focus();
    return true;
};

class GotoLinePanel implements Panel {
    dom: HTMLElement;
    top = true;

    private field: HTMLInputElement;
    private fieldBox: HTMLElement;

    constructor(private view: EditorView) {
        const phrase = (text: string, ...insert: unknown[]) => view.state.phrase(text, ...insert);
        const label = phrase("Go to line");

        this.field = el("input", {
            type: "text",
            name: "line",
            class: "ed-search-input",
            placeholder: label,
            "aria-label": label,
            autocomplete: "off",
            spellcheck: "false",
            inputmode: "numeric",
            form: "",
        });
        this.field.addEventListener("input", () => this.fieldBox.classList.remove("ed-search-none"));
        this.fieldBox = el("div", { class: "ed-search-field" }, [this.field]);

        const go = el("button", { type: "button", name: "go", class: "ed-search-button" }, [phrase("Go")]);
        go.addEventListener("click", () => this.go());
        const close = iconButton("close", phrase("Close"), ICONS.close, () => closeGotoLine(view));
        close.classList.add("ed-search-close");

        this.dom = el("div", { class: "ed-search ed-goto" }, [
            el("div", { class: "ed-search-row" }, [
                this.fieldBox,
                go,
                el("span", { class: "ed-search-count" }, [phrase("1 to $, or line:column", view.state.doc.lines)]),
                close,
            ]),
        ]);
        this.dom.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                e.preventDefault();
                this.go();
            } else if (e.key === "Escape") {
                e.preventDefault();
                closeGotoLine(view);
            }
        });
    }

    private go() {
        const pos = parseLineTarget(this.view.state, this.field.value);
        if (pos === null) {
            this.fieldBox.classList.add("ed-search-none");
            this.field.select();
            return;
        }
        this.view.dispatch({
            effects: [toggleGotoLine.of(false), EditorView.scrollIntoView(pos, { y: "center" })],
            selection: EditorSelection.cursor(pos),
            userEvent: "select",
        });
        this.view.focus();
    }

    mount() {
        this.field.focus();
    }
}

// The Find and Replace panel, in place of @codemirror/search's own. That package still does the
// searching, highlighting and replacing: this is its panel (search({ createPanel })), so its
// commands and key bindings work as before.
import { StateEffect, StateField, EditorSelection } from "@codemirror/state";
import { EditorView, runScopeHandlers, type Command, type Panel, type ViewUpdate } from "@codemirror/view";
import {
    SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext,
    setSearchQuery,
} from "@codemirror/search";
import { el, iconButton, isMac, ICONS } from "./dom.js";
import { findMatches, matchFrom, matchIndex, NO_MATCHES, type Matches } from "./matches.js";

// Whether the Replace row is showing. Kept in the state, so it's remembered while the panel is
// closed.
export const setReplaceOpen = StateEffect.define<boolean>();

export const replaceOpen = StateField.define<boolean>({
    create: () => false,
    update(value, tr) {
        for (const effect of tr.effects) if (effect.is(setReplaceOpen)) value = effect.value;
        return value;
    },
});

// Open the panel with the Replace row showing
export const openReplacePanel: Command = view => {
    if (!view.state.readOnly) view.dispatch({ effects: setReplaceOpen.of(true) });
    return openSearchPanel(view);
};

interface Toggle {
    button: HTMLButtonElement;
    // The key that toggles it, with Alt
    code: string;
}

export class SearchPanel implements Panel {
    dom: HTMLElement;
    top = true;

    private query: SearchQuery;
    private matches: Matches = NO_MATCHES;
    private searchField: HTMLInputElement;
    private replaceField: HTMLInputElement;
    private fieldBox: HTMLElement;
    private count: HTMLElement;
    private expand: HTMLButtonElement;
    private replaceRow: HTMLElement;
    private caseToggle: Toggle;
    private wordToggle: Toggle;
    private regexpToggle: Toggle;
    private needMatches: HTMLButtonElement[];

    // `test` says which matches count, when only part of the document is searched
    constructor(private view: EditorView, private test?: SearchQuery["test"]) {
        const phrase = (text: string) => view.state.phrase(text);
        const query = this.query = getSearchQuery(view.state);

        this.searchField = el("input", {
            type: "text",
            name: "search",
            class: "ed-search-input",
            placeholder: phrase("Find"),
            "aria-label": phrase("Find"),
            autocomplete: "off",
            spellcheck: "false",
            form: "",
            // How @codemirror/search finds the field to focus
            "main-field": "true",
        });
        this.searchField.value = query.search;
        this.searchField.addEventListener("input", () => this.commit(true));

        this.replaceField = el("input", {
            type: "text",
            name: "replace",
            class: "ed-search-input",
            placeholder: phrase("Replace"),
            "aria-label": phrase("Replace"),
            autocomplete: "off",
            spellcheck: "false",
            form: "",
        });
        this.replaceField.value = query.replace;
        this.replaceField.addEventListener("input", () => this.commit(false));

        this.caseToggle = this.toggle("case", "Aa", phrase("Match case"), "KeyC", query.caseSensitive);
        this.wordToggle = this.toggle("word", "ab", phrase("Match whole word"), "KeyW", query.wholeWord);
        this.regexpToggle = this.toggle("regexp", ".*", phrase("Use regular expression"), "KeyR", query.regexp);

        this.fieldBox = el("div", { class: "ed-search-field" }, [
            this.searchField,
            this.caseToggle.button,
            this.wordToggle.button,
            this.regexpToggle.button,
        ]);

        this.count = el("span", { class: "ed-search-count", "aria-live": "polite" });

        this.expand = iconButton("expand", phrase("Replace"), ICONS.chevron, () => {
            const open = !view.state.field(replaceOpen);
            view.dispatch({ effects: setReplaceOpen.of(open) });
            if (open) this.replaceField.focus();
        });
        this.expand.classList.add("ed-search-expand");

        const previous = iconButton("prev", phrase("Previous match"), ICONS.up, () => findPrevious(view));
        const next = iconButton("next", phrase("Next match"), ICONS.down, () => findNext(view));
        const close = iconButton("close", phrase("Close"), ICONS.close, () => closeSearchPanel(view));
        close.classList.add("ed-search-close");

        const replace = this.textButton("replace", phrase("Replace"), () => replaceNext(view));
        const all = this.textButton("replaceAll", phrase("Replace all"), () => replaceAll(view));
        this.needMatches = [previous, next, replace, all];

        this.replaceRow = el("div", { class: "ed-search-row ed-search-replace" }, [
            el("div", { class: "ed-search-field" }, [this.replaceField]),
            replace,
            all,
        ]);

        this.dom = el("div", { class: "ed-search", role: "search" }, [
            el("div", { class: "ed-search-row" }, [this.expand, this.fieldBox, this.count, previous, next, close]),
            this.replaceRow,
        ]);
        this.dom.addEventListener("keydown", e => this.keydown(e));

        this.showReplace();
        this.findMatches();
    }

    private toggle(name: string, text: string, label: string, code: string, pressed: boolean): Toggle {
        const key = `${isMac() ? "⌥" : "Alt+"}${code.slice(3)}`;
        const button = el("button", {
            type: "button",
            name,
            class: `ed-search-toggle ed-search-toggle-${name}`,
            title: `${label} (${key})`,
            "aria-label": label,
            "aria-pressed": String(pressed),
        }, [el("span", {}, [text])]);
        button.addEventListener("click", () => this.flip(button));
        return { button, code };
    }

    private flip(button: HTMLButtonElement) {
        button.setAttribute("aria-pressed", String(!pressed(button)));
        this.commit(true);
    }

    private textButton(name: string, label: string, onClick: () => void): HTMLButtonElement {
        const button = el("button", { type: "button", name, class: "ed-search-button" }, [label]);
        button.addEventListener("click", onClick);
        return button;
    }

    // The fields have changed: search for what they say now. Typing in the Find field also goes
    // to the first match from the cursor, so the author sees it without pressing Enter.
    private commit(jump: boolean) {
        const query = new SearchQuery({
            search: this.searchField.value,
            caseSensitive: pressed(this.caseToggle.button),
            regexp: pressed(this.regexpToggle.button),
            wholeWord: pressed(this.wordToggle.button),
            replace: this.replaceField.value,
            test: this.test,
        });
        if (query.eq(this.query)) return;
        this.query = query;
        const { state } = this.view;
        const matches = findMatches(state, query);
        const main = state.selection.main;
        const match = jump && matchIndex(matches, main.from, main.to) < 0 ? matchFrom(matches, main.from) : null;
        this.view.dispatch({
            effects: [
                setSearchQuery.of(query),
                ...(match ? [EditorView.scrollIntoView(EditorSelection.range(match.from, match.to), { y: "nearest", yMargin: 60 })] : []),
            ],
            selection: match ? EditorSelection.single(match.from, match.to) : undefined,
            userEvent: match ? "select.search" : undefined,
        });
    }

    private keydown(e: KeyboardEvent) {
        const toggle = e.altKey && !e.ctrlKey && !e.metaKey
            ? [this.caseToggle, this.wordToggle, this.regexpToggle].find(t => t.code === e.code)
            : undefined;
        if (toggle) {
            e.preventDefault();
            this.flip(toggle.button);
        } else if (runScopeHandlers(this.view, e, "search-panel")) {
            e.preventDefault();
        } else if (e.key === "Enter" && e.target === this.searchField) {
            e.preventDefault();
            (e.shiftKey ? findPrevious : findNext)(this.view);
        } else if (e.key === "Enter" && e.target === this.replaceField) {
            e.preventDefault();
            (e.ctrlKey || e.metaKey ? replaceAll : replaceNext)(this.view);
        }
    }

    update(update: ViewUpdate) {
        let queryChanged = false;
        for (const tr of update.transactions) {
            for (const effect of tr.effects) {
                if (!effect.is(setSearchQuery)) continue;
                queryChanged = true;
                if (!effect.value.eq(this.query)) this.setQuery(effect.value);
            }
        }
        if (update.startState.field(replaceOpen) !== update.state.field(replaceOpen) || update.startState.readOnly !== update.state.readOnly) {
            this.showReplace();
        }
        if (queryChanged || update.docChanged) this.findMatches();
        else if (update.selectionSet) this.showCount();
    }

    // A query set from outside the panel, e.g. from the selection when Find is pressed again
    private setQuery(query: SearchQuery) {
        this.query = query;
        this.searchField.value = query.search;
        this.replaceField.value = query.replace;
        this.caseToggle.button.setAttribute("aria-pressed", String(query.caseSensitive));
        this.wordToggle.button.setAttribute("aria-pressed", String(query.wholeWord));
        this.regexpToggle.button.setAttribute("aria-pressed", String(query.regexp));
    }

    private showReplace() {
        const { state } = this.view;
        const open = state.field(replaceOpen) && !state.readOnly;
        this.expand.hidden = state.readOnly;
        this.expand.setAttribute("aria-expanded", String(open));
        this.replaceRow.hidden = !open;
    }

    private findMatches() {
        this.matches = findMatches(this.view.state, this.query);
        this.showCount();
    }

    private showCount() {
        const { state } = this.view;
        const { list, capped } = this.matches;
        const total = `${list.length}${capped ? "+" : ""}`;
        const main = state.selection.main;
        const current = matchIndex(this.matches, main.from, main.to);
        const none = !!this.query.search && !list.length;

        let text: string;
        if (!this.query.search) text = "";
        else if (!this.query.valid) text = state.phrase("Invalid pattern");
        else if (!list.length) text = state.phrase("No results");
        else if (current >= 0) text = state.phrase("$1 of $2", current + 1, total);
        else text = state.phrase(list.length === 1 && !capped ? "$ result" : "$ results", total);
        if (this.count.textContent !== text) this.count.textContent = text;

        this.fieldBox.classList.toggle("ed-search-none", none);
        for (const button of this.needMatches) button.disabled = !list.length;
    }

    mount() {
        this.searchField.select();
    }
}

function pressed(button: HTMLButtonElement): boolean {
    return button.getAttribute("aria-pressed") === "true";
}

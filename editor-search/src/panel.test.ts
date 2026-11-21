// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { closeSearchPanel, findNext, getSearchQuery, openSearchPanel } from "@codemirror/search";
import { editorSearch, editorSearchKeymap, openGotoLine, openReplacePanel } from "./index.js";

let view: EditorView;

function editor(doc: string, readOnly = false) {
    view = new EditorView({
        doc,
        parent: document.body,
        extensions: [editorSearch(), keymap.of(editorSearchKeymap), EditorState.readOnly.of(readOnly)],
    });
    return view;
}

afterEach(() => view?.destroy());

const $ = <T extends HTMLElement>(selector: string) => view.dom.querySelector<T>(selector)!;

function type(input: HTMLInputElement, text: string) {
    input.value = text;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
    target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
}

describe("the Find panel", () => {
    test("replaces CodeMirror's own", () => {
        editor("one two one");
        openSearchPanel(view);
        expect($(".ed-search")).toBeTruthy();
        expect(view.dom.querySelector(".cm-search")).toBeNull();
        expect($("[main-field]")).toBe($("input[name=search]"));
    });

    test("typing searches, goes to the first match from the cursor, and counts", () => {
        editor("one two one two one");
        view.dispatch({ selection: { anchor: 5 } });
        openSearchPanel(view);
        type($("input[name=search]"), "one");
        expect(getSearchQuery(view.state).search).toBe("one");
        expect(view.state.selection.main).toMatchObject({ from: 8, to: 11 });
        expect($(".ed-search-count").textContent).toBe("2 of 3");

        findNext(view);
        expect($(".ed-search-count").textContent).toBe("3 of 3");
        view.dispatch({ selection: { anchor: 0 } });
        expect($(".ed-search-count").textContent).toBe("3 results");
    });

    test("no results, and an invalid pattern", () => {
        editor("one two");
        openSearchPanel(view);
        type($("input[name=search]"), "three");
        expect($(".ed-search-count").textContent).toBe("No results");
        expect($(".ed-search-field").classList.contains("ed-search-none")).toBe(true);
        expect($<HTMLButtonElement>("button[name=next]").disabled).toBe(true);

        $("button[name=regexp]").click();
        type($("input[name=search]"), "(");
        expect($(".ed-search-count").textContent).toBe("Invalid pattern");
    });

    test("the toggles change the query", () => {
        editor("Cat cat category");
        openSearchPanel(view);
        type($("input[name=search]"), "cat");
        expect($(".ed-search-count").textContent).toBe("1 of 3");
        $("button[name=case]").click();
        expect(getSearchQuery(view.state).caseSensitive).toBe(true);
        expect($(".ed-search-count").textContent).toBe("1 of 2");
        press($("input[name=search]"), "w", { code: "KeyW", altKey: true });
        expect(getSearchQuery(view.state).wholeWord).toBe(true);
        expect($("button[name=word]").getAttribute("aria-pressed")).toBe("true");
        expect($(".ed-search-count").textContent).toBe("1 of 1");
    });

    test("Enter finds the next match, and Shift+Enter the one before", () => {
        editor("a b a b a");
        openSearchPanel(view);
        const field = $<HTMLInputElement>("input[name=search]");
        type(field, "a");
        press(field, "Enter");
        expect(view.state.selection.main.from).toBe(4);
        press(field, "Enter", { shiftKey: true });
        expect(view.state.selection.main.from).toBe(0);
    });

    test("the Replace row opens, replaces, and is remembered", () => {
        editor("one two one");
        openSearchPanel(view);
        expect($(".ed-search-replace").hidden).toBe(true);
        $("button[name=expand]").click();
        expect($(".ed-search-replace").hidden).toBe(false);

        type($("input[name=search]"), "one");
        type($("input[name=replace]"), "1");
        press($("input[name=replace]"), "Enter");
        expect(view.state.doc.toString()).toBe("1 two one");
        $("button[name=replaceAll]").click();
        expect(view.state.doc.toString()).toBe("1 two 1");
        expect($(".ed-search-count").textContent).toBe("No results");

        closeSearchPanel(view);
        openSearchPanel(view);
        expect($(".ed-search-replace").hidden).toBe(false);
    });

    test("opens with Replace showing, but not in a read-only editor", () => {
        editor("one");
        openReplacePanel(view);
        expect($(".ed-search-replace").hidden).toBe(false);
        view.destroy();

        editor("one", true);
        openReplacePanel(view);
        expect($(".ed-search-replace").hidden).toBe(true);
        expect($("button[name=expand]").hidden).toBe(true);
    });

    test("Escape closes it", () => {
        editor("one");
        openSearchPanel(view);
        press($("input[name=search]"), "Escape", { keyCode: 27 } as KeyboardEventInit);
        expect(view.dom.querySelector(".ed-search")).toBeNull();
    });
});

describe("Go to line", () => {
    test("goes to the line and closes", () => {
        editor("one\ntwo\nthree");
        expect(openGotoLine(view)).toBe(true);
        const field = $<HTMLInputElement>(".ed-goto input");
        type(field, "3");
        press(field, "Enter");
        expect(view.state.selection.main.head).toBe(view.state.doc.line(3).from);
        expect(view.dom.querySelector(".ed-goto")).toBeNull();
    });

    test("stays open for something that isn't a line", () => {
        editor("one\ntwo");
        openGotoLine(view);
        const field = $<HTMLInputElement>(".ed-goto input");
        type(field, "two");
        press(field, "Enter");
        expect($(".ed-goto .ed-search-field").classList.contains("ed-search-none")).toBe(true);
        press(field, "Escape");
        expect(view.dom.querySelector(".ed-goto")).toBeNull();
    });

    test("is what the Go to line key opens", () => {
        const binding = editorSearchKeymap.find(b => b.key === "Mod-Alt-g");
        expect(binding?.run).toBe(openGotoLine);
    });
});

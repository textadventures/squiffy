import { Settings } from "./settings";
import { init as initAce } from "./ace-integration";

let editor: AceAjax.Editor;

export const init = (options: Settings, onEditorChange: () => void, onCursorMoved: () => void) => {
    editor = ace.edit("editor");

    // get rid of an annoying warning
    editor.$blockScrolling = Infinity;

    initAce();

    editor.setTheme("ace/theme/squiffy");
    editor.getSession().setMode("ace/mode/squiffy");
    editor.getSession().setUseWrapMode(true);
    editor.setShowPrintMargin(false);
    editor.getSession().on("change", onEditorChange);
    editor.on("changeSelection", function () {
        onCursorMoved();
    });
    editor.commands.removeCommand("goToNextError");
    editor.commands.removeCommand("goToPreviousError");
    editor.commands.removeCommand("showSettingsMenu");

    editor.setFontSize(options.userSettings.get("fontSize"));
    editor.focus();
}

export const getCurrentRow = () => editor.selection.getCursor().row;
export const getValue = () => editor.getValue();
export const setValue = (data: string) => editor.getSession().setValue(data);
export const setFontSize = (size: number) => editor.setFontSize(`${size}px`);
export const getCopyText = () => editor.getCopyText();
export const replaceSelectedText = (text: string) => editor.session.replace(editor.selection.getRange(), text);
export const getLineCount = () => editor.session.doc.getAllLines().length;

export const replaceLine = (line: number, text: string) => {
    const Range = ace.require("ace/range").Range;
    const range = new Range(line, 0, line, 0);
    editor.session.replace(range, text);
}

export const collapseAll = () => editor.session.foldAll();
export const uncollapseAll = () => editor.session.unfold(null, true);

export const moveTo = function (row: number, column?: number) {
    column = column || 0;
    const Range = ace.require("ace/range").Range;
    editor.selection.setRange(new Range(row, column, row, column), false);
    editor.renderer.scrollCursorIntoView();
    editor.focus();
};
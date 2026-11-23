import { describe, expect, test } from "vitest";
import { CompletionItemKind, DiagnosticSeverity, DiagnosticTag, SymbolKind } from "vscode-languageserver";
import { groupDiagnostics, toLspCompletion, toLspSymbol, toLspWorkspaceEdit } from "./convert.js";

const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } };
const root = "file:///w/game/";

describe("conversion to LSP", () => {
    test("groups diagnostics by file URI", () => {
        const byUri = groupDiagnostics(root, [
            { file: "main.squiffy", range, severity: "error", code: "squiffy/unknown-section-link", message: "No section" },
            { file: "rooms/a b.squiffy", range, severity: "hint", code: "squiffy/redundant-import", message: "Not needed" },
            { file: "", range, severity: "warning", code: "squiffy/dead-end", message: "Nowhere" },
        ]);
        expect([...byUri.keys()]).toEqual(["file:///w/game/main.squiffy", "file:///w/game/rooms/a%20b.squiffy"]);
        expect(byUri.get("file:///w/game/main.squiffy")![0]).toMatchObject({ severity: DiagnosticSeverity.Error, code: "squiffy/unknown-section-link" });
        expect(byUri.get("file:///w/game/rooms/a%20b.squiffy")![0]).toMatchObject({ severity: DiagnosticSeverity.Hint, tags: [DiagnosticTag.Unnecessary] });
    });

    test("names unnamed sections by their detail", () => {
        const symbol = toLspSymbol({ name: "", detail: "(Start)", kind: "section", range, selectionRange: range, children: [
            { name: "door", kind: "passage", range, selectionRange: range, children: [] },
        ] });
        expect(symbol).toMatchObject({ name: "(Start)", detail: undefined, kind: SymbolKind.Class });
        expect(symbol.children![0]).toMatchObject({ name: "door", kind: SymbolKind.Method });
    });

    test("completes with an edit of what's been typed", () => {
        expect(toLspCompletion({ label: "cellar", kind: "section", range, insertText: "cellar]]" })).toMatchObject({
            kind: CompletionItemKind.Class,
            textEdit: { range, newText: "cellar]]" },
        });
    });

    test("maps edits' paths to URIs", () => {
        expect(toLspWorkspaceEdit(root, { "rooms/a.squiffy": [{ range, newText: "x" }] })).toEqual({
            changes: { "file:///w/game/rooms/a.squiffy": [{ range, newText: "x" }] },
        });
    });
});

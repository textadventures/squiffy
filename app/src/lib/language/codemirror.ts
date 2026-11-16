// Connects a CodeMirror editor to the language service worker: diagnostics as lint markers, and
// the document outline, both refreshed shortly after typing stops.
import type { Extension, Text } from "@codemirror/state";
import { linter, lintGutter, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import type { DocumentSymbol, Position } from "squiffy-compiler/language-service";
import type { LanguageClient } from "./client.js";

const DELAY_MS = 300;

// A language service position (zero-based line and UTF-16 character) as a document offset
export function toOffset(doc: Text, position: Position): number {
    if (position.line >= doc.lines) return doc.length;
    const line = doc.line(position.line + 1);
    return Math.min(line.from + position.character, line.to);
}

export function toPosition(doc: Text, offset: number): Position {
    const line = doc.lineAt(offset);
    return { line: line.number - 1, character: offset - line.from };
}

export interface LanguageFeatureOptions {
    client: LanguageClient;
    path: string;
    // Called with the outline after each analysis that's still current
    onSymbols?(symbols: DocumentSymbol[]): void;
}

export function languageFeatures({ client, path, onSymbols }: LanguageFeatureOptions): Extension[] {
    return [
        linter(async view => {
            const doc = view.state.doc;
            await client.call("updateFile", path, doc.toString());
            const [diagnostics, symbols] = await Promise.all([
                client.call("getDiagnostics", path),
                client.call("getDocumentSymbols", path),
            ]);
            // CodeMirror drops the diagnostics itself if the text changed meanwhile
            if (view.state.doc === doc) onSymbols?.(symbols);
            return diagnostics.map((d): CmDiagnostic => ({
                from: toOffset(doc, d.range.start),
                to: toOffset(doc, d.range.end),
                severity: d.severity,
                message: d.message,
                source: d.code,
            }));
        }, { delay: DELAY_MS }),
        lintGutter(),
    ];
}

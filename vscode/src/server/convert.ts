// The language service's results as LSP types. Positions and ranges are already LSP's, so it's
// mostly kinds, severities, and project paths to URIs.

import {
    CodeAction as LspCodeAction, CodeActionKind, CompletionItem as LspCompletionItem, CompletionItemKind, Diagnostic as LspDiagnostic,
    DiagnosticSeverity, DiagnosticTag, DocumentSymbol as LspDocumentSymbol, MarkupKind, SymbolKind, WorkspaceEdit as LspWorkspaceEdit,
} from "vscode-languageserver";
import type {
    CodeAction, CompletionItem, Diagnostic, DocumentSymbol, WorkspaceEdit,
} from "squiffy-compiler/language-service";
import { toUri } from "./stories.js";

const SEVERITIES: Record<Diagnostic["severity"], DiagnosticSeverity> = {
    error: DiagnosticSeverity.Error,
    warning: DiagnosticSeverity.Warning,
    hint: DiagnosticSeverity.Hint,
};

// Problems about something that's never used, which VS Code shows faded out
const UNNECESSARY = new Set<Diagnostic["code"]>(["squiffy/redundant-import", "squiffy/unreachable-section"]);

export function toLspDiagnostic(diagnostic: Diagnostic): LspDiagnostic {
    return {
        range: diagnostic.range,
        severity: SEVERITIES[diagnostic.severity],
        // Shown as the source, so there's no source as well: it would say "squiffy" twice
        code: diagnostic.code,
        message: diagnostic.message,
        tags: UNNECESSARY.has(diagnostic.code) ? [DiagnosticTag.Unnecessary] : undefined,
        // Kept so a quick fix can be matched back to the diagnostic it fixes
        data: { code: diagnostic.code, subject: diagnostic.subject },
    };
}

// The diagnostics by file URI
export function groupDiagnostics(root: string, diagnostics: Diagnostic[]): Map<string, LspDiagnostic[]> {
    const byUri = new Map<string, LspDiagnostic[]>();
    for (const diagnostic of diagnostics) {
        if (!diagnostic.file) continue;
        const uri = toUri(root, diagnostic.file);
        if (!byUri.has(uri)) byUri.set(uri, []);
        byUri.get(uri)!.push(toLspDiagnostic(diagnostic));
    }
    return byUri;
}

const SYMBOL_KINDS: Record<DocumentSymbol["kind"], SymbolKind> = {
    title: SymbolKind.String,
    section: SymbolKind.Class,
    passage: SymbolKind.Method,
    snippet: SymbolKind.Function,
};

export function toLspSymbol(symbol: DocumentSymbol): LspDocumentSymbol {
    return {
        name: symbol.name || symbol.detail || "(unnamed)",
        detail: symbol.name ? symbol.detail : undefined,
        kind: SYMBOL_KINDS[symbol.kind],
        range: symbol.range,
        selectionRange: symbol.selectionRange,
        children: symbol.children.map(toLspSymbol),
    };
}

const COMPLETION_KINDS: Record<CompletionItem["kind"], CompletionItemKind> = {
    section: CompletionItemKind.Class,
    passage: CompletionItemKind.Method,
    attribute: CompletionItemKind.Variable,
    snippet: CompletionItemKind.Snippet,
    directive: CompletionItemKind.Keyword,
};

export function toLspCompletion(item: CompletionItem): LspCompletionItem {
    return {
        label: item.label,
        kind: COMPLETION_KINDS[item.kind],
        detail: item.detail,
        textEdit: { range: item.range, newText: item.insertText ?? item.label },
        // VS Code filters on the text the edit replaces, so the label has to match what's typed
        filterText: item.insertText ?? item.label,
    };
}

export function toLspWorkspaceEdit(root: string, edit: WorkspaceEdit): LspWorkspaceEdit {
    return {
        changes: Object.fromEntries(Object.entries(edit).map(([path, edits]) => [toUri(root, path), edits])),
    };
}

export function toLspCodeAction(root: string, action: CodeAction): LspCodeAction {
    return {
        title: action.title,
        kind: CodeActionKind.QuickFix,
        diagnostics: action.diagnostic ? [toLspDiagnostic(action.diagnostic)] : undefined,
        edit: toLspWorkspaceEdit(root, action.edit),
        isPreferred: action.isPreferred,
    };
}

export const markdown = (contents: string) => ({ kind: MarkupKind.Markdown, value: contents });

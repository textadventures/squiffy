// The Problems panel's list: every diagnostic in the story, each with the quick fixes for it.
import type { CodeAction, Diagnostic, Position } from "squiffy-compiler/language-service";

// One file's diagnostics and code actions, as the language service worker sends them
export interface FileProblems {
    file: string;
    diagnostics: Diagnostic[];
    actions: CodeAction[];
}

export interface Problem {
    diagnostic: Diagnostic;
    fixes: CodeAction[];
}

export interface ProblemCounts {
    error: number;
    warning: number;
    hint: number;
}

const SEVERITY_ORDER: Record<Diagnostic["severity"], number> = { error: 0, warning: 1, hint: 2 };

// Which diagnostic a code action fixes: its code and where it starts
export const diagnosticKey = (d: { code: string; range: { start: Position } }) =>
    `${d.code}@${d.range.start.line}:${d.range.start.character}`;

// The fixes for each diagnostic, by diagnosticKey. A file-wide action (one with no diagnostic,
// e.g. converting all of a file's Squiffy 5 syntax) goes on every Squiffy 5 diagnostic.
export function fixesByDiagnostic<T>(actions: CodeAction[], wrap: (action: CodeAction) => T): Map<string, T[]> {
    const byDiagnostic = new Map<string, T[]>();
    const fileWide = actions.filter(a => !a.diagnostic);
    for (const action of actions) {
        if (!action.diagnostic) continue;
        const key = diagnosticKey(action.diagnostic);
        const list = byDiagnostic.get(key) ?? [];
        list.push(wrap(action));
        byDiagnostic.set(key, list);
    }
    for (const [key, list] of byDiagnostic) {
        if (key.startsWith("squiffy/v5-syntax")) list.push(...fileWide.map(wrap));
    }
    return byDiagnostic;
}

// Every problem in the story: errors first, then warnings, then hints; and within those, by file
// (the main file first) and line
export function collectProblems(files: FileProblems[], mainFile?: string): Problem[] {
    const problems: Problem[] = [];
    for (const { diagnostics, actions } of files) {
        const fixes = fixesByDiagnostic(actions, a => a);
        for (const diagnostic of diagnostics) {
            problems.push({ diagnostic, fixes: fixes.get(diagnosticKey(diagnostic)) ?? [] });
        }
    }
    const fileRank = (file: string) => (file === mainFile ? 0 : 1);
    return problems.sort((a, b) => {
        const x = a.diagnostic;
        const y = b.diagnostic;
        return SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity]
            || fileRank(x.file) - fileRank(y.file)
            || x.file.localeCompare(y.file)
            || x.range.start.line - y.range.start.line
            || x.range.start.character - y.range.start.character;
    });
}

export function countProblems(problems: Problem[]): ProblemCounts {
    const counts: ProblemCounts = { error: 0, warning: 0, hint: 0 };
    for (const p of problems) counts[p.diagnostic.severity]++;
    return counts;
}

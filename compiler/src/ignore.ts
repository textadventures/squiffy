// {{!-- squiffy-ignore code --}} turns off a warning the author knows is wrong, or doesn't mind:
// for the section it's in (and its passages), or in the master section, for the whole story. After
// the code, names say which of its warnings: {{!-- squiffy-ignore unknown-name board score --}}.
// The code can leave out "squiffy/". Errors can't be turned off.
import type { Diagnostic, Range, SectionNode, SquiffyFile } from "./syntax.js";

export interface IgnoreComment {
    // e.g. "squiffy/unknown-name"
    code: string;
    subjects: string[];
    range: Range;
}

const IGNORE_COMMENT = /\{\{~?!(?:--)?\s*squiffy-ignore\b([\s\S]*?)(?:--)?~?\}\}/g;

// The squiffy-ignore comments in a section, its passages included
export function findIgnoreComments(section: SectionNode): IgnoreComment[] {
    const result: IgnoreComment[] = [];
    for (const container of [section, ...section.passages]) {
        for (const statement of container.body) {
            if (statement.type != "text") continue;
            for (const match of statement.text.matchAll(IGNORE_COMMENT)) {
                const [code, ...subjects] = match[1].split(/[\s,]+/).filter(Boolean);
                if (!code) continue;
                const line = statement.range.start.line;
                const character = statement.range.start.character + match.index!;
                result.push({
                    code: code.startsWith("squiffy/") ? code : `squiffy/${code}`,
                    subjects,
                    range: { start: { line, character }, end: { line, character: character + match[0].length } },
                });
            }
        }
    }
    return result;
}

const isMaster = (section: SectionNode) => section.header?.type == "section-header" && section.header.name == "";

const matches = (comment: IgnoreComment, diagnostic: Diagnostic) =>
    comment.code == diagnostic.code
    && (!comment.subjects.length || (diagnostic.subject !== undefined && comment.subjects.includes(diagnostic.subject)));

// The section a position in a file is in: the last one that starts on or before its line
function sectionAt(file: SquiffyFile, line: number): SectionNode | undefined {
    let current: SquiffyFile["sections"][number] = file.preamble;
    for (const node of file.sections) {
        if (node.range.start.line <= line) current = node;
    }
    return current.type == "section" ? current : undefined;
}

// The warnings and hints that squiffy-ignore comments turn off
export function ignoredDiagnostics(files: SquiffyFile[], diagnostics: Diagnostic[]): Set<Diagnostic> {
    const ignored = new Set<Diagnostic>();
    const bySection = new Map<SectionNode, IgnoreComment[]>();
    const everywhere: IgnoreComment[] = [];
    for (const file of files) {
        for (const section of [file.preamble, ...file.sections]) {
            if (section.type != "section") continue;
            const comments = findIgnoreComments(section);
            if (!comments.length) continue;
            if (isMaster(section)) everywhere.push(...comments);
            else bySection.set(section, comments);
        }
    }
    if (!everywhere.length && !bySection.size) return ignored;

    const fileNamed = new Map(files.map(f => [f.filename ?? "", f]));
    for (const diagnostic of diagnostics) {
        if (diagnostic.severity == "error") continue;
        if (everywhere.some(c => matches(c, diagnostic))) {
            ignored.add(diagnostic);
            continue;
        }
        const file = fileNamed.get(diagnostic.file);
        const section = file && sectionAt(file, diagnostic.range.start.line);
        if (section && bySection.get(section)?.some(c => matches(c, diagnostic))) ignored.add(diagnostic);
    }
    return ignored;
}

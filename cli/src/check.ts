// --check: the problems the editor shows, for the whole story, without building it. Uses the
// language service, so it finds what the build does and more: sections nothing links to, and
// dead ends. With --json, the result is for tools such as AI agents to read.

import fs from "fs/promises";
import path from "path";
import { isAlwaysSkipped, PROJECT_FILENAME } from "squiffy-compiler";
import { createLanguageService, type Diagnostic, type ProjectFiles } from "squiffy-compiler/language-service";
import type { StoryOnDisk } from "squiffy-compiler/node";

export interface CheckProblem {
    // Relative to the current folder, with "/" separators, or "" if it isn't in a file
    file: string;
    // 1-based
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
    severity: Diagnostic["severity"];
    code: Diagnostic["code"];
    message: string;
}

export interface CheckResult {
    // False if there are any errors, which would stop the story building
    success: boolean;
    errors: number;
    warnings: number;
    problems: CheckProblem[];
    story: {
        start?: string;
        sections: number;
        passages: number;
        // The sections marked with @end
        endings: string[];
    };
    // Something to tell the author, e.g. that only one file was checked
    note?: string;
}

// The project's files, read from disk under a root folder
function projectFiles(root: string, hide: (path: string) => boolean): ProjectFiles {
    return {
        async list() {
            const result: { path: string }[] = [];
            const walk = async (relative: string) => {
                const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
                for (const entry of entries) {
                    const child = relative ? `${relative}/${entry.name}` : entry.name;
                    if (entry.isDirectory()) {
                        if (!isAlwaysSkipped(`${child}/x`)) await walk(child);
                    }
                    else if (!hide(child)) {
                        result.push({ path: child });
                    }
                }
            };
            await walk("");
            return result;
        },
        readText: file => fs.readFile(path.join(root, file), "utf8"),
    };
}

// The language service for a story on disk. A project is read from its squiffy.json's folder. A
// story that's just a file and its @imports is read from the file's folder, ignoring any
// squiffy.json, as when it's built.
export function storyService(story: StoryOnDisk) {
    const root = path.dirname(story.projectFile ?? story.mainFile);
    const service = createLanguageService({
        files: projectFiles(root, file => !story.projectFile && file == PROJECT_FILENAME),
        mainFile: path.relative(root, story.mainFile).split(path.sep).join("/"),
    });
    return { service, root };
}

export async function checkStory(story: StoryOnDisk, cwd = process.cwd()): Promise<CheckResult> {
    const { service, root } = storyService(story);

    const diagnostics = await service.getAllDiagnostics();
    const graph = await service.getStoryGraph();

    const displayPath = (file: string) => file ? path.relative(cwd, path.join(root, file)).split(path.sep).join("/") : "";
    const problems = diagnostics.map((d): CheckProblem => ({
        file: displayPath(d.file),
        line: d.range.start.line + 1,
        column: d.range.start.character + 1,
        endLine: d.range.end.line + 1,
        endColumn: d.range.end.character + 1,
        severity: d.severity,
        code: d.code,
        message: d.message,
    }));
    const severityOrder = { error: 0, warning: 1, hint: 2 };
    problems.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]
        || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.line - b.line || a.column - b.column);

    // The master section, "", is part of every section rather than one of its own
    const sections = graph.nodes.filter(n => n.kind == "section" && n.name != "");
    const errors = problems.filter(p => p.severity == "error").length;
    return {
        success: errors == 0,
        errors,
        warnings: problems.filter(p => p.severity == "warning").length,
        problems,
        story: {
            start: sections.find(n => n.start)?.name,
            sections: sections.length,
            passages: graph.nodes.filter(n => n.kind == "passage").length,
            endings: sections.filter(n => n.ending).map(n => n.name),
        },
        ...(story.note ? { note: story.note } : {}),
    };
}

const plural = (count: number, word: string) => `${count} ${word}${count == 1 ? "" : "s"}`;

export function formatCheckResult(result: CheckResult): string {
    const lines: string[] = [];
    if (result.note) lines.push(result.note);
    for (const p of result.problems) {
        const where = p.file ? `${p.file}:${p.line}:${p.column}` : "(story)";
        lines.push(`${where}: ${p.severity}: ${p.message} [${p.code}]`);
    }
    if (result.problems.length) lines.push("");
    const { story } = result;
    lines.push(`${plural(story.sections, "section")} and ${plural(story.passages, "passage")}`
        + (story.start !== undefined ? `, starting at "${story.start}"` : "")
        + (story.endings.length ? `, with ${plural(story.endings.length, "ending")}: ${story.endings.map(e => `"${e}"`).join(", ")}` : ", with no sections marked @end")
        + ".");
    lines.push(result.errors || result.warnings
        ? `${plural(result.errors, "error")}, ${plural(result.warnings, "warning")}.`
        : "No problems found.");
    return lines.join("\n");
}

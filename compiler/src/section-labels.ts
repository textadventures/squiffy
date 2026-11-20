// What messages call sections, so that a section without a name of its own isn't called by the
// name the compiler gives it. Used by the compiler's warnings, the story graph's and the CLI's.

import type { SectionNode, SquiffyFile } from "./syntax.js";

// What the outline calls a section without a name of its own
export function sectionDetail(node: SectionNode): string | undefined {
    if (node.kind == "preamble") return "(Start)";
    if (node.header?.type == "continue") return `+++${node.header.text}`;
    if (node.header?.type == "separator") return "---";
    return undefined;
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ordinal = (n: number) => ORDINALS[n - 1] ?? `${n}th`;
export const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// What messages call each section, by name. A section without a name of its own is called by its
// +++ or --- line, not the name the compiler gives it (_continue1, ...), which the author never
// wrote and can't search for. As a story can have lots of "+++Continue..." lines, it also says
// which named section it comes after, and which one it is if there are several:
// 'the section "cave"', 'the "+++Continue..." after "cave"', 'the second "---" after "cave"',
// 'the third "+++Next"' (before any named section), 'the text before the first section'.
export function sectionLabels(files: Iterable<SquiffyFile>, nameOf: (node: SectionNode) => string | undefined): Map<string, string> {
    const labels = new Map<string, string>();
    for (const tree of files) {
        // The sections without names of their own since the last named one
        let after: string | undefined;
        let run: { name: string; detail: string }[] = [];
        const finish = () => {
            const total = new Map<string, number>();
            for (const { detail } of run) total.set(detail, (total.get(detail) ?? 0) + 1);
            const seen = new Map<string, number>();
            for (const { name, detail } of run) {
                const n = (seen.get(detail) ?? 0) + 1;
                seen.set(detail, n);
                const which = total.get(detail)! > 1 ? `${ordinal(n)} ` : "";
                const where = after !== undefined ? ` after "${after}"` : "";
                labels.set(name, `the ${which}"${detail}"${where}`);
            }
            run = [];
        };
        for (const node of [tree.preamble, ...tree.sections]) {
            if (node.type != "section") continue;
            const name = nameOf(node);
            if (name === undefined) continue;
            if (node.kind == "preamble") {
                labels.set(name, "the text before the first section");
                continue;
            }
            const detail = sectionDetail(node);
            if (detail === undefined) {
                finish();
                after = name;
                labels.set(name, `the section "${name}"`);
                continue;
            }
            run.push({ name, detail });
        }
        finish();
    }
    return labels;
}

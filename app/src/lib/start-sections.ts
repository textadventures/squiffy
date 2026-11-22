// The sections the preview's Start at menu lists: those with names of their own, in the story's
// order, with the ones for testing (@test) first, as on a story's page served by the CLI.

import type { StoryGraph } from "squiffy-compiler/language-service";

export interface StartSection {
    name: string;
    // Marked with @test: a section that sets up a scene to test
    test: boolean;
}

export function startSections(graph: StoryGraph): StartSection[] {
    // A section with a detail is one without a name of its own: the text before the first
    // section, or one after a +++ or --- line
    const sections = graph.nodes.filter(n => n.kind == "section" && n.name != "" && !n.detail);
    // Only the sections marked @test go first, not everything they lead to
    const marked = sections.filter(n => n.test == "marked");
    const others = sections.filter(n => n.test != "marked");
    return [...marked, ...others].map(n => ({ name: n.name, test: n.test == "marked" }));
}

// The sections whose names have the text typed into the menu's search box
export const findSections = (sections: StartSection[], text: string) => {
    const find = text.trim().toLowerCase();
    return find ? sections.filter(s => s.name.toLowerCase().includes(find)) : sections;
};

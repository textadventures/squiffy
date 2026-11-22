// Lists of a story's sections and passages, and their @tag tags (#527), for the passages,
// sections and tags helpers and squiffy.story in JavaScript. This is how a story chooses among
// its passages without listing their names a second time.
import type { Passage, Section, Story, TagFilter } from "./types.js";

const tagList = (tags: string | string[] | undefined): string[] =>
    tags === undefined ? [] : (Array.isArray(tags) ? tags : String(tags).split(/\s+/)).map(String).filter(t => t);

function matches(item: Section | Passage, filter: TagFilter) {
    const tags = item.tags ?? [];
    return tagList(filter.tagged).every(t => tags.includes(t))
        && !tagList(filter.untagged).some(t => tags.includes(t));
}

// The master passage, and passages such as @1, @last and @after, run by themselves, so they
// aren't listed
const isSpecial = (name: string) => name === "" || name.startsWith("@");

function sectionNamed(story: Story, name: string): Section {
    const section = story.sections[name];
    if (!section) throw new Error(`There's no section called "${name}"`);
    return section;
}

// The passages of the named section ("" for the master section), in the order they're written,
// apart from the special ones.
// With no section, the current section's passages, then the master section's, which links in
// the current section can also reach.
export function listPassages(story: Story, sectionName: string | undefined, currentSection: string, filter: TagFilter = {}): string[] {
    const sections = sectionName === undefined
        ? [story.sections[currentSection], story.sections[""]]
        : [sectionNamed(story, sectionName)];
    const names: string[] = [];
    for (const section of sections) {
        for (const [name, passage] of Object.entries(section?.passages ?? {})) {
            if (!isSpecial(name) && !names.includes(name) && matches(passage, filter)) names.push(name);
        }
    }
    return names;
}

// The story's sections, in the order they're written, apart from the master section
export function listSections(story: Story, filter: TagFilter = {}): string[] {
    return Object.entries(story.sections)
        .filter(([name, section]) => name !== "" && matches(section, filter))
        .map(([name]) => name);
}

// A passage's tags, or a section's: a passage in the current section, then one in the master
// section, then a section, as a passage link would find it
export function tagsOf(story: Story, name: string, currentSection: string): string[] {
    const item = story.sections[currentSection]?.passages?.[name]
        ?? story.sections[""]?.passages?.[name]
        ?? story.sections[name];
    if (!item) throw new Error(`There's no section or passage called "${name}"`);
    return [...(item.tags ?? [])];
}

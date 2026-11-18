// Reads a Twine story from Twee (Twee 3, and the older Twee 1/2 that Twine 1 and Tweego read)
// or from Twine's HTML (Twine 2's published or archive HTML, and Twine 1's), into one shape for
// the converters.

export interface TwinePassage {
    name: string;
    tags: string[];
    text: string;
    // Where the passage's box is on Twine's story map: its top left corner, and its size (100 by
    // 100 unless the author made it bigger). Twee 1 and 2 don't have them.
    position?: [number, number];
    size?: [number, number];
}

export type TwineFormat = "harlowe" | "sugarcube" | "other";

export interface TwineStory {
    title: string;
    // The story format as given, e.g. "Harlowe" or "SugarCube"
    formatName: string;
    formatVersion: string;
    format: TwineFormat;
    // The name of the start passage, if the story says which it is
    start?: string;
    passages: TwinePassage[];
    // The story stylesheet and JavaScript, including passages tagged stylesheet or script
    stylesheet: string;
    script: string;
}

export class TwineParseError extends Error {}

export function formatOf(name: string): TwineFormat {
    const lower = name.toLowerCase();
    if (lower.startsWith("harlowe")) return "harlowe";
    // Twine 1's formats (Sugarcane, Jonah) have <<macros>> like SugarCube's, which grew out of them
    if (lower.startsWith("sugarcube") || lower == "sugarcane" || lower == "jonah" || lower == "") return "sugarcube";
    return "other";
}

// Whether some text looks like a Twine story, rather than any other HTML or text file
export function isTwineSource(text: string): boolean {
    return /<tw-storydata[\s>]/i.test(text) || /<div[^>]*\bid=["']storeArea["']/i.test(text) || /^::\s*\S/m.test(text);
}

export function parseTwine(text: string): TwineStory {
    if (/<tw-storydata[\s>]/i.test(text)) return parseTwine2Html(text);
    if (/<div[^>]*\bid=["']storeArea["']/i.test(text)) return parseTwine1Html(text);
    if (/^::/m.test(text)) return parseTwee(text);
    throw new TwineParseError("This doesn't look like a Twine story: there's no story data in it.");
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
    return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity: string) => {
        if (entity[0] == "#") {
            const code = entity[1] == "x" || entity[1] == "X" ? parseInt(entity.substring(2), 16) : parseInt(entity.substring(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        return entities[entity.toLowerCase()] ?? match;
    });
}

function attributes(tag: string): Record<string, string> {
    const result: Record<string, string> = {};
    const regex = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let match;
    while ((match = regex.exec(tag))) {
        result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
    }
    return result;
}

// "x,y" or "width,height", as Twine writes them
function pair(value: unknown): [number, number] | undefined {
    if (typeof value != "string") return undefined;
    const parts = value.split(",").map(n => Number(n.trim()));
    return parts.length == 2 && parts.every(n => Number.isFinite(n)) ? [parts[0], parts[1]] : undefined;
}

// The passage's place on Twine's map, if it has one
function place(position: unknown, size: unknown): { position?: [number, number], size?: [number, number] } {
    const p = pair(position);
    if (!p) return {};
    const s = pair(size);
    return s && s[0] > 0 && s[1] > 0 ? { position: p, size: s } : { position: p };
}

function splitTags(tags: string | undefined): string[] {
    return (tags ?? "").split(/\s+/).filter(t => t.length > 0);
}

// Separates the passages that hold the story's CSS and JavaScript, as Twine 1 and Twee do with
// tags, from the passages of the story itself.
function splitSpecial(passages: TwinePassage[], stylesheet: string[], script: string[]): TwinePassage[] {
    return passages.filter(p => {
        if (p.tags.includes("stylesheet")) {
            stylesheet.push(p.text);
            return false;
        }
        if (p.tags.includes("script")) {
            script.push(p.text);
            return false;
        }
        return !p.tags.includes("Twine.private") && !p.tags.includes("annotation");
    });
}

function parseTwine2Html(html: string): TwineStory {
    const storyTag = /<tw-storydata\b[^>]*>/i.exec(html)!;
    const story = attributes(storyTag[0]);
    const body = html.substring(storyTag.index + storyTag[0].length);
    const end = body.search(/<\/tw-storydata>/i);
    const data = end == -1 ? body : body.substring(0, end);

    const stylesheet: string[] = [];
    const script: string[] = [];
    for (const match of data.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)) {
        if (/twine-user-stylesheet|text\/twine-css/i.test(match[1])) stylesheet.push(decodeEntities(match[2]));
    }
    for (const match of data.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (/twine-user-script|text\/twine-javascript/i.test(match[1])) script.push(decodeEntities(match[2]));
    }

    let start: string | undefined;
    const passages: TwinePassage[] = [];
    for (const match of data.matchAll(/<tw-passagedata\b([^>]*)>([\s\S]*?)<\/tw-passagedata>/gi)) {
        const a = attributes(match[1]);
        const passage: TwinePassage = { name: a.name ?? "", tags: splitTags(a.tags), text: decodeEntities(match[2]), ...place(a.position, a.size) };
        if (a.pid !== undefined && a.pid == story.startnode) start = passage.name;
        passages.push(passage);
    }

    const formatName = story.format ?? "";
    return {
        title: story.name ?? "",
        formatName,
        formatVersion: story["format-version"] ?? "",
        format: formatOf(formatName),
        start,
        passages: splitSpecial(passages, stylesheet, script),
        stylesheet: stylesheet.join("\n\n").trim(),
        script: script.join("\n\n").trim(),
    };
}

function parseTwine1Html(html: string): TwineStory {
    const start = html.search(/<div[^>]*\bid=["']storeArea["']/i);
    const data = html.substring(start);
    const passages: TwinePassage[] = [];
    for (const match of data.matchAll(/<div\b([^>]*\btiddler=[^>]*)>([^<]*)<\/div>/gi)) {
        const a = attributes(match[1]);
        // Twine 1 escapes newlines and backslashes in passage text
        const text = decodeEntities(match[2]).replace(/\\(.)/g, (_m, c: string) => c == "n" ? "\n" : c == "t" ? "\t" : c == "s" ? " " : c);
        passages.push({ name: a.tiddler ?? "", tags: splitTags(a.tags), text, ...place(a["twine-position"], undefined) });
    }
    return fromTwee1Passages(passages);
}

// Twine 1 and Twee 1/2 keep the title and settings in passages
function fromTwee1Passages(all: TwinePassage[]): TwineStory {
    const stylesheet: string[] = [];
    const script: string[] = [];
    const special = new Map<string, string>();
    const passages = splitSpecial(all, stylesheet, script).filter(p => {
        if (["StoryTitle", "StorySettings", "StoryIncludes", "StoryData"].includes(p.name)) {
            special.set(p.name, p.text);
            return false;
        }
        return true;
    });

    let formatName = "";
    let formatVersion = "";
    let start: string | undefined;
    const storyData = special.get("StoryData");
    if (storyData) {
        try {
            const data = JSON.parse(storyData);
            formatName = data.format ?? "";
            formatVersion = data["format-version"] ?? "";
            start = data.start;
        }
        catch {
            // Treated as if there were no StoryData
        }
    }
    if (!start && passages.some(p => p.name == "Start")) start = "Start";

    return {
        title: (special.get("StoryTitle") ?? "").trim(),
        formatName,
        formatVersion,
        format: formatOf(formatName),
        start,
        passages,
        stylesheet: stylesheet.join("\n\n").trim(),
        script: script.join("\n\n").trim(),
    };
}

// Twee: each passage starts with a line ":: Name [tags] {metadata}". In names, \ escapes
// [ ] { } and \ itself. A line in a passage that would start with :: is written \::.
function parseTwee(text: string): TwineStory {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const passages: TwinePassage[] = [];
    let current: (ReturnType<typeof parseTweeHeader> & { lines: string[] }) | null = null;

    const finish = () => {
        if (!current) return;
        // Twee separates passages with blank lines, which aren't part of the passage
        while (current.lines.length && current.lines[current.lines.length - 1].trim() == "") current.lines.pop();
        const { lines, ...header } = current;
        passages.push({ ...header, text: lines.join("\n") });
    };

    for (const line of lines) {
        if (line.startsWith("::")) {
            finish();
            const header = parseTweeHeader(line.substring(2));
            current = { ...header, lines: [] };
        }
        else if (current) {
            current.lines.push(line.startsWith("\\::") ? line.substring(1) : line);
        }
    }
    finish();
    return fromTwee1Passages(passages);
}

// Twee 3 puts the passage's place on the map in its metadata, e.g. {"position":"600,400","size":"100,200"}
function parseTweeHeader(header: string): Omit<TwinePassage, "text"> {
    let name = "";
    let i = 0;
    const s = header.trimStart();
    for (; i < s.length; i++) {
        const c = s[i];
        if (c == "\\" && i + 1 < s.length) {
            name += s[++i];
        }
        else if (c == "[" || c == "{") {
            break;
        }
        else {
            name += c;
        }
    }
    let tags: string[] = [];
    const rest = s.substring(i);
    const tagMatch = /^\[((?:\\.|[^\]])*)\]/.exec(rest);
    if (tagMatch) tags = splitTags(tagMatch[1].replace(/\\(.)/g, "$1"));
    const metadata = rest.substring(tagMatch?.[0].length ?? 0).trim();
    let placed = {};
    if (metadata.startsWith("{")) {
        try {
            const data = JSON.parse(metadata);
            placed = place(data?.position, data?.size);
        }
        catch {
            // Metadata that isn't JSON is left out
        }
    }
    return { name: name.trim(), tags, ...placed };
}

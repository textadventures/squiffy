// Converts the links in a section's or passage's text into Handlebars helpers, and records
// where each link and embed was in the original text.
//
// The conversion is a series of regex replacements, each running on the output of the one
// before, and the exact order matters (for example, [[a]](b) has to be converted before [a](b)
// would match inside it). So rather than parse links some other way, this runs exactly those
// replacements, and keeps a map from each position in the current string back to the original
// text, so that what each regex matched can be traced to where it was written.

// A run of the current string that came from original[origStart, origEnd).
// If copied, it's an unchanged copy, so positions map one to one. Otherwise it's the
// replacement for that whole range.
interface Segment {
    start: number;
    end: number;
    origStart: number;
    origEnd: number;
    copied: boolean;
}

interface Replacement {
    start: number;
    end: number;
    text: string;
}

class MappedString {
    value: string;
    private segments: Segment[];

    constructor(private readonly original: string) {
        this.value = original;
        this.segments = original.length
            ? [{ start: 0, end: original.length, origStart: 0, origEnd: original.length, copied: true }]
            : [];
    }

    // Like String.replace with a global regex, except the callback gets the match's offset.
    replace(regex: RegExp, replacer: (match: string[], offset: number) => string) {
        const replacements: Replacement[] = [];
        this.value = this.value.replace(regex, (...args) => {
            // The callback's arguments are the match, the groups, the offset and the whole string.
            // None of these regexes have named groups, so there's no groups object after those.
            const offset = args[args.length - 2] as number;
            const match = args.slice(0, args.length - 2) as string[];
            const text = replacer(match, offset);
            replacements.push({ start: offset, end: offset + match[0].length, text });
            return text;
        });
        if (replacements.length) {
            this.applyToSegments(replacements);
        }
    }

    private applyToSegments(replacements: Replacement[]) {
        const segments: Segment[] = [];
        let newPos = 0;
        const copyRange = (from: number, to: number) => {
            for (const s of this.segments) {
                const start = Math.max(s.start, from);
                const end = Math.min(s.end, to);
                if (start >= end) continue;
                const length = end - start;
                segments.push(s.copied
                    ? { start: newPos, end: newPos + length, origStart: s.origStart + start - s.start, origEnd: s.origStart + end - s.start, copied: true }
                    : { start: newPos, end: newPos + length, origStart: s.origStart, origEnd: s.origEnd, copied: false });
                newPos += length;
            }
        };

        let oldPos = 0;
        for (const r of replacements) {
            copyRange(oldPos, r.start);
            const origStart = this.mapStart(r.start);
            const origEnd = this.mapEnd(r.end);
            if (r.text.length) {
                segments.push({
                    start: newPos,
                    end: newPos + r.text.length,
                    origStart,
                    origEnd,
                    copied: r.text === this.original.substring(origStart, origEnd),
                });
                newPos += r.text.length;
            }
            oldPos = r.end;
        }
        copyRange(oldPos, Infinity);
        this.segments = segments;
    }

    // Maps the start of a range in the current string to the original string.
    mapStart(pos: number): number {
        const s = this.find(seg => seg.end > pos);
        if (!s) return this.original.length;
        if (pos < s.start) return s.origStart;
        return s.copied ? s.origStart + pos - s.start : s.origStart;
    }

    // Maps the (exclusive) end of a range in the current string to the original string.
    mapEnd(pos: number): number {
        const s = this.find(seg => seg.end >= pos);
        if (!s) return this.original.length;
        if (pos <= s.start) return s.origStart;
        return s.copied ? s.origStart + pos - s.start : s.origEnd;
    }

    // Binary search for the first segment matching a predicate that's monotonic in segment order.
    private find(predicate: (seg: Segment) => boolean): Segment | undefined {
        let low = 0;
        let high = this.segments.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (predicate(this.segments[mid])) high = mid;
            else low = mid + 1;
        }
        return this.segments[low];
    }
}

// Offsets below are into the original text.
export interface TextLink {
    linkType: "section" | "passage";
    form: "named" | "unnamed" | "next" | "input";
    text?: string;
    // The target as written (see LinkNode.target). For next links, the setters after ">".
    target: string;
    start: number;
    end: number;
    targetStart: number;
    targetEnd: number;
}

export interface TextEmbed {
    name: string;
    start: number;
    end: number;
    nameStart: number;
    nameEnd: number;
}

// {{goto "name"}} with a literal name: the same as an embed
export type TextGoto = TextEmbed;

// {{deactivate "name"}} with a literal name (#13). Only the first name is found, which is enough
// for the warning and for renaming in the usual case.
export type TextDeactivate = TextEmbed;

export interface NoNextSection {
    // The legacy warning shows the link as [[text>]] or [[text]](>)
    display: string;
    start: number;
    end: number;
}

export interface TransformResult {
    output: string;
    // Links in the order the compiler has always checked them: named section links, named
    // passage links, unnamed section links, then unnamed passage links. Next links come first.
    links: TextLink[];
    embeds: TextEmbed[];
    gotos: TextGoto[];
    deactivates: TextDeactivate[];
    noNextSection: NoNextSection[];
}

// The target is everything before the first comma, and the setters everything after it. With
// expressions, they're kept as written, since a setter can contain commas in quotes, and the
// runtime splits them. Without, a space is added after each comma, as Squiffy 6 did.
function extractLinkFunctions(link: string, expressions: boolean): { target: string, setters: string } {
    if (!expressions) {
        const fragments = link.split(",");
        return {
            target: fragments[0].trim(),
            setters: fragments.slice(1).join(", ")
        };
    }
    const comma = link.indexOf(",");
    return {
        target: (comma == -1 ? link : link.substring(0, comma)).trim(),
        setters: comma == -1 ? "" : link.substring(comma + 1),
    };
}

function getAdditionalLinkParameters(link: string, expressions: boolean): { target: string, additionalParameters: string } {
    const functions = extractLinkFunctions(link, expressions);
    let additionalParameters = "";
    if (functions.setters.trim().length > 0) {
        additionalParameters += ` set="${escapeForHandlebarsString(functions.setters)}"`;
    }
    return {
        target: functions.target,
        additionalParameters
    };
}

// Text with balanced brackets, nested up to three deep, as few characters as possible
const noBrackets = "[^()]";
const nested = (inner: string) => `\\((?:${noBrackets}|${inner})*\\)`;
export const balancedTarget = `(?:${noBrackets}|${nested(nested(nested(noBrackets)))})*?`;

function escapeForHandlebarsString(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// getNextSectionName returns the section after this one, for [[text>]] links, or null if
// there isn't one.
// expressions: whether link setters take expressions (see AnalyseSettings.expressions)
export function transformText(text: string, getNextSectionName: () => string | null, expressions = false): TransformResult {
    const input = new MappedString(text);
    const links: TextLink[] = [];
    const embeds: TextEmbed[] = [];
    const noNextSection: NoNextSection[] = [];

    // Records a link, given the offset of its match and of its target group in the current string.
    const addLink = (link: Omit<TextLink, "start" | "end" | "targetStart" | "targetEnd">,
        matchStart: number, matchLength: number, targetStart: number, targetLength: number) => {
        links.push({
            ...link,
            start: input.mapStart(matchStart),
            end: input.mapEnd(matchStart + matchLength),
            targetStart: input.mapStart(targetStart),
            targetEnd: input.mapEnd(targetStart + targetLength),
        });
    };

    // Handlebars expressions can contain square brackets that aren't links, such as
    // {{someArray.[1]}} or {{someHelper "[x]"}}, so swap each one for a placeholder while
    // converting links. Text between block helpers like {{#if x}}...{{/if}} is still converted. A
    // comment ends at --}}, and can have }} and links in it before that.
    const mustaches: string[] = [];
    input.replace(/\{\{!--[\s\S]*?--\}\}|\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}/g, ([match]) => {
        mustaches.push(match);
        return `${mustaches.length - 1}`;
    });
    const restore = (s: string) => s.replace(/(\d+)/g, (_match, i) => mustaches[Number(i)]);
    // A link once it's converted, kept out of the way of the patterns for later kinds of link, which
    // would otherwise find links in its setters, such as the [1] in [[Go]](next, party[1].hp += 2)
    const converted = (helper: string) => {
        mustaches.push(helper);
        return `${mustaches.length - 1}`;
    };

    // A link's target, inside its (...). With expressions, a setter can have brackets in it, e.g.
    // [[Buy]](shop, gold -= (price - 1) * 2), so the target can contain balanced brackets, up to
    // three deep. Without, it ends at the first ")", as in Squiffy 6.
    const target = expressions ? balancedTarget : "(?:.*?)";

    // nextSectionLinkRegex matches [[text>]] - a link to the next section. Followed by a (target),
    // it's a named link whose text ends with >, such as [[<i>Go in</i>]](cave).
    const nextSectionLinkRegex = /\[\[([^\]]*?)>\]\](?!\()/g;

    input.replace(nextSectionLinkRegex, ([match, rawText], offset) => {
        const text = restore(rawText);
        const nextSectionName = getNextSectionName();
        if (!nextSectionName) {
            noNextSection.push({ display: `[[${text}>]]`, start: input.mapStart(offset), end: input.mapEnd(offset + match.length) });
            return `[[${text}]]`; // fallback
        }
        addLink({ linkType: "section", form: "next", text, target: "" }, offset, match.length, offset + 2 + rawText.length, 0);
        return converted(`{{section "${escapeForHandlebarsString(nextSectionName)}" text="${escapeForHandlebarsString(text)}"}}`);
    });

    // namedNextSectionLinkRegex matches [[text]](>) or [[text]](>, setter=value)
    // - a named link where target starts with >
    const namedNextSectionLinkRegex = new RegExp(`\\[\\[([^\\]]*?)\\]\\]\\(>(${target})\\)`, "g");

    input.replace(namedNextSectionLinkRegex, ([match, rawText, rawRest], offset) => {
        const text = restore(rawText);
        const rest = restore(rawRest);
        const nextSectionName = getNextSectionName();
        if (!nextSectionName) {
            noNextSection.push({ display: `[[${text}]](>)`, start: input.mapStart(offset), end: input.mapEnd(offset + match.length) });
            return `[[${text}]]`; // fallback
        }
        addLink({ linkType: "section", form: "next", text, target: rest }, offset, match.length, offset + 2 + rawText.length + 4, rawRest.length);
        // rest could be empty or ", setter=value"
        const parsedName = getAdditionalLinkParameters(nextSectionName + rest, expressions);
        return converted(`{{section "${escapeForHandlebarsString(parsedName.target)}" text="${escapeForHandlebarsString(text)}"${parsedName.additionalParameters}}}`);
    });

    // namedSectionLinkRegex matches:
    //   open [[
    //   any text - the link text
    //   closing ]]
    //   open bracket
    //   any text - the name of the section
    //   closing bracket
    const namedSectionLinkRegex = new RegExp(`\\[\\[([^\\]]*?)\\]\\]\\((${target})\\)`, "g");

    input.replace(namedSectionLinkRegex, ([match, rawText, rawName], offset) => {
        const text = restore(rawText);
        const name = restore(rawName);
        addLink({ linkType: "section", form: "named", text, target: name }, offset, match.length, offset + 2 + rawText.length + 3, rawName.length);
        const parsedName = getAdditionalLinkParameters(name, expressions);
        return converted(`{{section "${escapeForHandlebarsString(parsedName.target)}" text="${escapeForHandlebarsString(text)}"${parsedName.additionalParameters}}}`);
    });

    // namedPassageLinkRegex matches:
    //   not preceded by ! (to avoid matching image links like ![alt](src))
    //   open [
    //   any text - the link text
    //   closing ]
    //   open bracket, but not http(s):// after it
    //   any text - the name of the passage
    //   closing bracket
    const namedPassageLinkRegex = new RegExp(`(?<!!)\\[([^\\]]*?)\\]\\(((?!https?:\\/\\/)${target})\\)`, "g");

    input.replace(namedPassageLinkRegex, ([match, rawText, rawName], offset) => {
        const text = restore(rawText);
        const name = restore(rawName);
        addLink({ linkType: "passage", form: "named", text, target: name }, offset, match.length, offset + 1 + rawText.length + 2, rawName.length);
        const parsedName = getAdditionalLinkParameters(name, expressions);
        return converted(`{{passage "${escapeForHandlebarsString(parsedName.target)}" text="${escapeForHandlebarsString(text)}"${parsedName.additionalParameters}}}`);
    });

    // unnamedSectionLinkRegex matches:
    //   open [[
    //   any text - the link text
    //   closing ]]
    const unnamedSectionLinkRegex = /\[\[(.*?)\]\]/g;

    input.replace(unnamedSectionLinkRegex, ([match, rawName], offset) => {
        const name = restore(rawName);
        addLink({ linkType: "section", form: "unnamed", target: name }, offset, match.length, offset + 2, rawName.length);
        return converted(`{{section "${escapeForHandlebarsString(name)}"}}`);
    });

    // unnamedPassageLinkRegex matches:
    //   not preceded by ! (to avoid matching image links like ![alt])
    //   open [
    //   any text - the link text
    //   closing ]
    //   no bracket after
    const unnamedPassageLinkRegex = /(?<!!)\[(.*?)\]([^(]|$)/g;

    input.replace(unnamedPassageLinkRegex, ([match, rawName, suffix], offset) => {
        const name = restore(rawName);
        addLink({ linkType: "passage", form: "unnamed", target: name }, offset, match.length - suffix.length, offset + 1, rawName.length);
        return converted(`{{passage "${escapeForHandlebarsString(name)}"}}`) + suffix;
    });

    input.replace(/(\d+)/g, ([, i]) => mustaches[Number(i)]);

    // Matches {{embed "name"}} or {{goto 'name'}} with a literal name. An embed can also be a
    // block, {{#embed "name"}}...{{/embed}}, which wraps text (#450).
    const findNamed = (helper: string, block = false) => {
        const result: TextEmbed[] = [];
        const regex = new RegExp(`\\{\\{~?\\s*${block ? "#?" : ""}${helper}\\s+(["'])(.*?)\\1`, "g");
        let match;
        while ((match = regex.exec(input.value))) {
            const start = match.index;
            const end = start + match[0].length;
            const nameEnd = end - 1;
            const nameStart = nameEnd - match[2].length;
            result.push({
                name: match[2],
                start: input.mapStart(start),
                end: input.mapEnd(end),
                nameStart: input.mapStart(nameStart),
                nameEnd: input.mapEnd(nameEnd),
            });
        }
        return result;
    };
    embeds.push(...findNamed("embed", true));

    // A text box that goes to a section or passage when Enter is pressed (#454), as in
    // <input data-attribute="name" data-section="next">. It's left as it is, and only recorded.
    const inputTag = /<input\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
    const targetAttribute = /\sdata-(section|passage)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
    let tag;
    while ((tag = inputTag.exec(input.value))) {
        const attribute = targetAttribute.exec(tag[0]);
        if (!attribute) continue;
        const name = attribute[2] ?? attribute[3] ?? attribute[4];
        const start = tag.index;
        const nameEnd = start + attribute.index + attribute[0].length - (attribute[4] === undefined ? 1 : 0);
        const nameStart = nameEnd - name.length;
        links.push({
            linkType: attribute[1].toLowerCase() == "section" ? "section" : "passage",
            form: "input",
            target: name,
            start: input.mapStart(start),
            end: input.mapEnd(start + tag[0].length),
            targetStart: input.mapStart(nameStart),
            targetEnd: input.mapEnd(nameEnd),
        });
    }

    return { output: input.value, links, embeds, gotos: findNamed("goto"), deactivates: findNamed("deactivate"), noNextSection };
}

export interface SourceLine {
    // Zero-based line number in the source file
    line: number;
    // Length of the source line. Text added by the compiler (the link a +++ line adds to the
    // previous section) maps onto the line it came from, clamped to that line's length.
    length: number;
}

// Returns a function that converts an offset into lines.join("\n") to a position in the source file.
export function positionMapper(lines: SourceLine[], lineLengths: number[]): (offset: number) => { line: number; character: number } {
    const starts: number[] = [];
    let pos = 0;
    for (const length of lineLengths) {
        starts.push(pos);
        pos += length + 1;
    }
    return (offset: number) => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (starts[mid] <= offset) low = mid;
            else high = mid - 1;
        }
        const source = lines[low];
        if (!source) return { line: 0, character: 0 };
        return { line: source.line, character: Math.min(offset - starts[low], source.length) };
    };
}

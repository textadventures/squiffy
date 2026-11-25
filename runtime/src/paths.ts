// Values inside objects and lists (#442). An attribute can hold an object, such as
// { hp: 10, name: "Ann" }, or a list, and a path names a value inside it:
//
//   hero.hp               the hp of the object in the attribute hero
//   inventory.0.name      the name of the first item in the list inventory
//   inventory[0].name     the same
//   hero["max hp"]        a name that isn't a plain word
//
// squiffy.get, squiffy.set, {{set}}, {{inc}}, {{live}} and the like take a path as text, with
// these rules. Setters (@set hero.hp = 10) can also use another attribute as an index,
// inventory[i].name, which runtime/src/squiffy.runtime.ts reads with readTarget.

// Names that would reach an object's prototype rather than a value in it
const forbidden = new Set(["__proto__", "prototype", "constructor"]);

export function checkSegment(segment: string) {
    if (forbidden.has(segment)) {
        throw new Error(`"${segment}" can't be used as a name inside an object`);
    }
}

// The segments of a path, e.g. ["inventory", "0", "name"] for inventory[0].name. A name with no
// "." or "[" is a whole attribute name, and so is one that isn't a path at all, such as "a..b".
export function parsePath(name: string): string[] {
    if (!name.includes(".") && !name.includes("[")) return [name];
    const root = /^[^.[\]]+/.exec(name);
    if (!root) return [name];
    const segments: string[] = [root[0]];
    let i = root[0].length;
    while (i < name.length) {
        if (name[i] === ".") {
            // inventory.0.name, or Handlebars' inventory.[0].name
            if (name[i + 1] === "[") {
                i++;
                continue;
            }
            const segment = /^[^.[\]]+/.exec(name.substring(i + 1));
            if (!segment) return [name];
            segments.push(segment[0]);
            i += 1 + segment[0].length;
        }
        else if (name[i] === "[") {
            const close = name.indexOf("]", i);
            if (close === -1) return [name];
            let segment = name.substring(i + 1, close).trim();
            const quoted = /^(["'])(.*)\1$/.exec(segment);
            if (quoted) segment = quoted[2];
            segments.push(segment);
            i = close + 1;
        }
        else {
            return [name];
        }
    }
    segments.forEach(checkSegment);
    return segments;
}

const isContainer = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

// The value at a path inside a value, or null if there's nothing there
export function valueAt(value: unknown, segments: string[]): unknown {
    for (const segment of segments) {
        if (!isContainer(value) || !Object.prototype.hasOwnProperty.call(value, segment)) return null;
        value = value[segment];
    }
    return value ?? null;
}

// A copy of root with the value at the path inside it changed. Objects that aren't there yet are
// made, so @set hero.hp = 10 works before hero has been set. Throws if the path goes through a
// value that isn't an object or a list, such as a number.
export function withValueAt(root: unknown, segments: string[], name: string, value: unknown): unknown {
    const result = isContainer(root) ? structuredClone(root) : root === null || root === undefined ? {} : null;
    if (result === null) {
        throw new Error(`${name} isn't an object, so it has no ${segments[0]}`);
    }
    let container: Record<string, unknown> = result;
    let path = name;
    segments.forEach((segment, i) => {
        checkSegment(segment);
        if (i === segments.length - 1) {
            container[segment] = value;
            return;
        }
        path += "." + segment;
        let next = Object.prototype.hasOwnProperty.call(container, segment) ? container[segment] : undefined;
        if (next === undefined || next === null) {
            next = {};
            container[segment] = next;
        }
        if (!isContainer(next)) {
            throw new Error(`${path} isn't an object, so it has no ${segments[i + 1]}`);
        }
        container = next;
    });
    return result;
}

// The target of a setter, e.g. hero.hp in hero.hp += 5 or inventory[i].name in
// inventory[i].name = "lamp": the attribute, then each name or index after it. An index is an
// expression, which the runtime works out when the setter runs.
export type TargetSegment = { name: string } | { index: string };

export interface Target {
    attribute: string;
    segments: TargetSegment[];
    // Everything after the target, e.g. " += 5"
    rest: string;
}

// Reads a setter's target from the start of a setter, or returns null if it doesn't start with an
// attribute name. Whitespace before it is skipped.
export function readTarget(text: string): Target | null {
    const start = /^\s*([\p{L}\p{N}_]+)/u.exec(text);
    if (!start) return null;
    const segments: TargetSegment[] = [];
    let i = start[0].length;
    for (;;) {
        const name = /^\.([\p{L}\p{N}_]+)/u.exec(text.substring(i));
        if (name) {
            segments.push({ name: name[1] });
            i += name[0].length;
            continue;
        }
        if (text[i] !== "[") break;
        const close = findClose(text, i);
        if (close === -1) return null;
        segments.push({ index: text.substring(i + 1, close) });
        i = close + 1;
    }
    return { attribute: start[1], segments, rest: text.substring(i) };
}

// The index of the "]" that closes the "[" at `open`, skipping quoted text and brackets inside it,
// or -1
function findClose(text: string, open: number): number {
    let depth = 0;
    let quote: string | null = null;
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            if (c === "\\") i++;
            else if (c === quote) quote = null;
        }
        else if (c === "\"" || c === "'") quote = c;
        else if (c === "[" || c === "(" || c === "{") depth++;
        else if (c === "]" || c === ")" || c === "}") {
            depth--;
            if (depth === 0) return c === "]" ? i : -1;
        }
    }
    return -1;
}

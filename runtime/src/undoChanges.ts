// Going back puts attributes back as they were before each section or passage, from an undo log
// kept on its element in the text. Mostly that's each attribute's old value, but for an object or
// list that's only changed a little, it's just what changed: otherwise _visits, _lastvisit and
// _seen_sections, which have an entry for every section visited, would be copied into every
// section in the text, and the text, which is saved, would grow with the square of the number of
// turns.

// What changed in an object (the keys' old values, and the keys that are new), or a list that was
// added to (its old length)
export type UndoChange = { set?: Record<string, unknown>; remove?: string[] } | { length: number };

export interface UndoEntry {
    // Attributes put back by their old value
    values: Record<string, unknown>;
    // Attributes put back by undoing what changed
    changes: Record<string, UndoChange>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (value === null || typeof value != "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
};

const same = (a: unknown, b: unknown) => a === b || (typeof a == "object" && a !== null && JSON.stringify(a) === JSON.stringify(b));

const hasOwn = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

// What going back needs to undo, from the attributes' values before and as they are now
export function undoEntry(oldValues: Record<string, unknown>, current: (attribute: string) => unknown): UndoEntry {
    const entry: UndoEntry = { values: {}, changes: {} };
    for (const [attribute, oldValue] of Object.entries(oldValues)) {
        const change = undoChange(oldValue, current(attribute));
        if (change) entry.changes[attribute] = change;
        else entry.values[attribute] = oldValue;
    }
    return entry;
}

function undoChange(oldValue: unknown, newValue: unknown): UndoChange | undefined {
    if (isPlainObject(oldValue) && isPlainObject(newValue)) {
        const set: Record<string, unknown> = {};
        const remove: string[] = [];
        for (const key of Object.keys(oldValue)) {
            if (!hasOwn(newValue, key) || !same(oldValue[key], newValue[key])) set[key] = oldValue[key];
        }
        for (const key of Object.keys(newValue)) {
            if (!hasOwn(oldValue, key)) remove.push(key);
        }
        return { ...(Object.keys(set).length ? { set } : {}), ...(remove.length ? { remove } : {}) };
    }
    if (Array.isArray(oldValue) && Array.isArray(newValue) && newValue.length >= oldValue.length
        && oldValue.every((item, i) => same(item, newValue[i]))) {
        return { length: oldValue.length };
    }
    return undefined;
}

// The value before the change, from the value after it
export function applyUndoChange(value: unknown, change: UndoChange): unknown {
    if ("length" in change) return Array.isArray(value) ? value.slice(0, change.length) : value;
    const result: Record<string, unknown> = isPlainObject(value) ? { ...value } : {};
    for (const key of change.remove ?? []) delete result[key];
    Object.assign(result, change.set);
    return result;
}

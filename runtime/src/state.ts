import { Emitter, SquiffyEventMap } from "./events.js";
import { parsePath, valueAt, withValueAt } from "./paths.js";

// The attribute the story reads the player's settings from
const SETTINGS = "settings";

export class State {
    persist: boolean;
    storyId: string;
    onSet: (attribute: string, value: any) => void;
    onSetInternal?: (attribute: string, oldValue: any, newValue: any) => void;
    store: Record<string, any> = {};
    emitter: Emitter<SquiffyEventMap>;

    constructor(persist: boolean,
                storyId: string,
                onSet: (attribute: string, value: any) => void,
                emitter: Emitter<SquiffyEventMap>,
                onSetInternal?: (attribute: string, oldValue: any, newValue: any) => void) {
        this.persist = persist;
        this.storyId = storyId;
        this.onSet = onSet;
        this.emitter = emitter;
        this.onSetInternal = onSetInternal;
    }

    // Set when localStorage couldn't be written, e.g. because it's full: the story's progress
    // isn't kept there any more, until the story's restarted
    private storageFailed = false;

    private usePersistentStorage() {
        return this.persist && !this.storageFailed && window.localStorage && this.storyId;
    }

    private storeAttribute(attribute: string, value: any) {
        try {
            localStorage.setItem(this.storyId + "-" + attribute, JSON.stringify(value));
        }
        catch (e) {
            // localStorage only holds a few megabytes for every story on the site. What's kept now
            // would be partly from one turn and partly from another, so it's cleared, and reloading
            // the page starts the story again rather than somewhere it couldn't have got to. The
            // story carries on, and can still be saved with the Saves button.
            console.warn(`Squiffy: the story's progress can't be kept in the browser's storage any more (${e instanceof Error ? e.message : e}).`);
            this.clearStored();
            this.storageFailed = true;
        }
    }

    // Removes the story's attributes from localStorage. With the "-", so that the story at /story
    // doesn't clear /story2's, nor the story at / every other story's on the site.
    private clearStored() {
        try {
            for (const key of Object.keys(localStorage)) {
                if (key.startsWith(this.storyId + "-")) localStorage.removeItem(key);
            }
        }
        catch {
            // Storage that can't be read or written
        }
    }

    // The player's settings (#452), which the story reads as the attribute "settings", e.g.
    // settings.textSize, or null if the story has none, when "settings" is an attribute like any other
    playerSettings: () => Record<string, unknown> | null = () => null;

    // Persistent attributes (squiffy.json's "persistent", #539): the names the story declares,
    // and their values, which are kept apart from the store. They belong to the player rather than
    // the playthrough, so restarting, going back and loading a saved game leave them as they are.
    persistentNames: () => string[] = () => [];
    persistentValues: Record<string, any> = {};
    // Where they're kept in localStorage, when persist is on
    private persistentKey?: string;

    // Starts with the values given, or else those kept in localStorage under the key, if any
    initPersistent(key: string | undefined, values?: Record<string, unknown>) {
        this.persistentKey = key;
        if (values) {
            this.persistentValues = structuredClone(values);
            return;
        }
        if (!key) return;
        try {
            const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
            if (saved && typeof saved == "object" && !Array.isArray(saved)) this.persistentValues = saved;
        }
        catch {
            // Nothing kept, or storage that can't be read
        }
    }

    isPersistent(attribute: string) {
        return this.persistentNames().includes(attribute);
    }

    // The persistent attributes the story has set, by name
    getPersistent(): Record<string, any> {
        const names = this.persistentNames();
        return structuredClone(Object.fromEntries(Object.entries(this.persistentValues).filter(([name]) => names.includes(name))));
    }

    // Clears the persistent attributes named, or all of them, as {{forget}} does
    forget(names?: string[]) {
        if (this.readOnly) return;
        const forgotten = (names ?? Object.keys(this.persistentValues))
            .filter(name => this.isPersistent(name) && Object.prototype.hasOwnProperty.call(this.persistentValues, name));
        if (!forgotten.length) return;
        for (const name of forgotten) delete this.persistentValues[name];
        this.storePersistent();
        for (const name of forgotten) {
            this.emitter.emit("set", { attribute: name, value: null });
            this.onSet(name, null);
        }
    }

    private storePersistent() {
        if (!this.persistentKey) return;
        try {
            localStorage.setItem(this.persistentKey, JSON.stringify(this.persistentValues));
        }
        catch {
            // Storage that's full or can't be written: they last until the page is closed
        }
    }

    // Where an attribute's value is kept: with the persistent attributes, or in the store
    private valuesFor(attribute: string): Record<string, any> {
        return this.isPersistent(attribute) ? this.persistentValues : this.store;
    }

    // While this is true, set() does nothing: e.g. while a panel is rendered, so its {{set}}s
    // don't change the story
    readOnly = false;

    // The name can be a path to a value inside an object or list, such as hero.hp (#442): see
    // paths.ts
    set(attribute: string, value: any) {
        this.setAt(parsePath(attribute), value);
    }

    // Sets the value at a path: the attribute, then the names inside it. The whole attribute is
    // set again, so going back, saves and the "set" event see the attribute that changed.
    setAt(segments: string[], value: any) {
        if (this.readOnly) return;
        const [attribute, ...inside] = segments;
        // Only the player changes their settings, in the Settings dialog
        if (attribute == SETTINGS && this.playerSettings()) {
            console.warn("Squiffy: the story can't change the player's settings.");
            return;
        }
        if (!inside.length) {
            this.setInternal(attribute, value, true);
            return;
        }
        if (typeof value === "undefined") value = true;
        const root = this.has(attribute) ? this.valuesFor(attribute)[attribute] : null;
        this.setInternal(attribute, withValueAt(root, inside, attribute, value), true);
    }

    setInternal(attribute: string, value: any, raiseEvents: boolean) {
        if (typeof value === "undefined") value = true;

        if (this.isPersistent(attribute)) {
            // Going back and loading a saved game set attributes without raising events, and
            // they leave persistent attributes as they are
            if (!raiseEvents) return;
            this.persistentValues[attribute] = structuredClone(value);
            this.storePersistent();
            this.emitter.emit("set", { attribute, value });
            this.onSet(attribute, value);
            return;
        }

        if (raiseEvents && this.onSetInternal) {
            this.onSetInternal(attribute, this.getAt([attribute]), structuredClone(value));
        }

        this.store[attribute] = structuredClone(value);

        if (this.usePersistentStorage()) {
            this.storeAttribute(attribute, value);
        }

        if (raiseEvents) {
            this.emitter.emit("set", { attribute, value });
        }

        this.onSet(attribute, value);
    }

    // Only the store's own properties are attributes, not ones it inherits, such as valueOf
    has(attribute: string) {
        if (attribute == SETTINGS && this.playerSettings()) return true;
        return Object.prototype.hasOwnProperty.call(this.valuesFor(attribute), attribute);
    }

    // The name can be a path, as for set()
    get(attribute: string): any {
        return this.getAt(parsePath(attribute));
    }

    getAt(segments: string[]): any {
        const [attribute, ...inside] = segments;
        if (!this.has(attribute)) return null;
        const settings = attribute == SETTINGS ? this.playerSettings() : null;
        if (settings) return inside.length ? structuredClone(valueAt(settings, inside)) : { ...settings };
        const values = this.valuesFor(attribute);
        const value = inside.length ? valueAt(values[attribute], inside) : values[attribute];
        return structuredClone(value);
    }

    getStore() {
        // Return a Proxy that reads from the current state dynamically.
        // This allows {{attribute}} in templates to reflect changes made
        // by helpers like {{inc}} during the same render pass.
        return new Proxy({} as Record<string, any>, {
            // A name that isn't an attribute is null, unless it's one every object has, like
            // valueOf, which Handlebars can use
            get: (target, prop) => typeof prop == "string" && (this.has(prop) || !(prop in target))
                ? this.getAt([prop])
                : Reflect.get(target, prop),
            has: (_, prop) => this.has(String(prop)),
            ownKeys: () => [...new Set([
                ...Object.keys(this.store).filter(key => !this.isPersistent(key)),
                ...Object.keys(this.getPersistent()),
                ...(this.playerSettings() ? [SETTINGS] : []),
            ])],
            getOwnPropertyDescriptor: (_, prop) => {
                const key = String(prop);
                if (this.has(key)) {
                    return {
                        enumerable: true,
                        configurable: true,
                        value: this.getAt([key])
                    };
                }
                return undefined;
            }
        });
    }

    load() {
        if (!this.usePersistentStorage()) {
            return;
        }

        const keys = Object.keys(localStorage);
        for (const key of keys) {
            if (key.startsWith(this.storyId + "-")) {
                const attribute = key.substring(this.storyId.length + 1);
                if (this.isPersistent(attribute)) continue;
                this.store[attribute] = JSON.parse(localStorage[key]);
            }
        }
    }

    // Persistent attributes are left as they are: forget() clears them
    // Restarting tries keeping progress in localStorage again, if it had stopped.
    reset() {
        this.store = {};
        this.storageFailed = false;

        if (!this.usePersistentStorage()) {
            return;
        }

        this.clearStored();
    }

    // Records a visit to a section or passage: adds it to _seen_sections, counts it in _visits
    // (#377), and keeps the turn it was on in _lastvisit (#540). They're all attributes, so going
    // back undoes them.
    setSeen(sectionName: string) {
        let seenSections = this.get("_seen_sections");
        if (!seenSections) seenSections = [];
        const visits = this.get("_visits") || {};
        // A save from before _visits has the name in _seen_sections with no count: that's one visit
        visits[sectionName] = this.getVisitsFrom(visits, seenSections, sectionName) + 1;
        this.set("_visits", visits);
        const lastVisit = this.get("_lastvisit") || {};
        lastVisit[sectionName] = this.get("turns") || 0;
        this.set("_lastvisit", lastVisit);
        if (seenSections.indexOf(sectionName) == -1) {
            seenSections.push(sectionName);
            this.set("_seen_sections", seenSections);
        }
    }

    getSeen(sectionName: string) {
        const seenSections = this.get("_seen_sections");
        if (!seenSections) return false;
        return (seenSections.indexOf(sectionName) > -1);
    }

    // How many times a section or passage has been visited, or 0 if it hasn't
    getVisits(sectionName: string): number {
        return this.getVisitsFrom(this.get("_visits") || {}, this.get("_seen_sections") || [], sectionName);
    }

    // How many turns ago a section or passage was last visited: 0 if the player is there now, and
    // -1 if they've never been there (#540)
    getLastVisited(sectionName: string): number {
        const lastVisit = this.get("_lastvisit") || {};
        const turns = this.get("turns") || 0;
        if (Object.prototype.hasOwnProperty.call(lastVisit, sectionName)) return turns - lastVisit[sectionName];
        // A save from before _lastvisit only says whether it's been visited: as if it was at the start
        return this.getSeen(sectionName) ? turns : -1;
    }

    private getVisitsFrom(visits: Record<string, number>, seenSections: string[], sectionName: string): number {
        if (Object.prototype.hasOwnProperty.call(visits, sectionName)) return visits[sectionName];
        return seenSections.indexOf(sectionName) > -1 ? 1 : 0;
    }
}
// The keys a story's progress is kept under in localStorage, for the storage key it uses: an item
// for each attribute, and the persistent attributes, player settings and mute button
const progressItems = (key: string) => [`squiffy-persistent:${key}`, `squiffy-settings:${key}`, `squiffy-muted:${key}`];

// Moves a story's progress from one storage key to another, if there's none under the new one yet:
// e.g. from the page's address, which Squiffy 6 and the 7.0 betas used, to squiffy.json's id
export function moveStoredProgress(from: string, to: string) {
    if (!from || from == to) return;
    try {
        const keys = Object.keys(localStorage);
        if (!keys.some(key => key.startsWith(to + "-"))) {
            for (const key of keys) {
                if (!key.startsWith(from + "-")) continue;
                localStorage.setItem(to + key.substring(from.length), localStorage.getItem(key)!);
                localStorage.removeItem(key);
            }
        }
        const fromItems = progressItems(from);
        progressItems(to).forEach((item, i) => {
            const value = localStorage.getItem(fromItems[i]);
            if (value === null) return;
            if (localStorage.getItem(item) === null) localStorage.setItem(item, value);
            localStorage.removeItem(fromItems[i]);
        });
    }
    catch {
        // Storage that can't be read or written
    }
}

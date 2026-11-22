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

    private usePersistentStorage() {
        return this.persist && window.localStorage && this.storyId;
    }

    // The player's settings (#452), which the story reads as the attribute "settings", e.g.
    // settings.textSize, or null if the story has none, when "settings" is an attribute like any other
    playerSettings: () => Record<string, unknown> | null = () => null;

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
        const root = this.has(attribute) ? this.store[attribute] : null;
        this.setInternal(attribute, withValueAt(root, inside, attribute, value), true);
    }

    setInternal(attribute: string, value: any, raiseEvents: boolean) {
        if (typeof value === "undefined") value = true;

        if (raiseEvents && this.onSetInternal) {
            this.onSetInternal(attribute, this.getAt([attribute]), structuredClone(value));
        }

        this.store[attribute] = structuredClone(value);

        if (this.usePersistentStorage()) {
            localStorage[this.storyId + "-" + attribute] = JSON.stringify(value);
        }

        if (raiseEvents) {
            this.emitter.emit("set", { attribute, value });
        }

        this.onSet(attribute, value);
    }

    // Only the store's own properties are attributes, not ones it inherits, such as valueOf
    has(attribute: string) {
        if (attribute == SETTINGS && this.playerSettings()) return true;
        return Object.prototype.hasOwnProperty.call(this.store, attribute);
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
        const value = inside.length ? valueAt(this.store[attribute], inside) : this.store[attribute];
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
            ownKeys: () => [...new Set([...Object.keys(this.store), ...(this.playerSettings() ? [SETTINGS] : [])])],
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
                this.store[attribute] = JSON.parse(localStorage[key]);
            }
        }
    }

    reset() {
        this.store = {};

        if (!this.usePersistentStorage()) {
            return;
        }

        const keys = Object.keys(localStorage);
        for (const key of keys) {
            if (key.startsWith(this.storyId)) {
                localStorage.removeItem(key);
            }
        }
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
// Whether each story was last left with the story map open, and full screen, kept in this
// browser, so an author who works on the map (as Twine authors do) comes back to it.

const KEY = "squiffy-map-layout";
// Stories remembered: the ones opened longest ago are forgotten first
const LIMIT = 100;

export interface MapLayout {
    open: boolean;
    maximized: boolean;
}

function readAll(): Record<string, MapLayout> {
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
        return stored && typeof stored == "object" && !Array.isArray(stored) ? stored as Record<string, MapLayout> : {};
    } catch {
        return {};
    }
}

// A story converted from Twine opens on the full-screen map the first time, as that's how its
// author is used to seeing it
let nextOpensOnMap = false;
export function openNextStoryOnMap() {
    nextOpensOnMap = true;
}

// How a story's map was left, by the story's (or folder's) id. Undefined if it isn't remembered.
export function readMapLayout(id: string): MapLayout | undefined {
    if (nextOpensOnMap) {
        nextOpensOnMap = false;
        return { open: true, maximized: true };
    }
    const layout = readAll()[id];
    return layout && typeof layout == "object" ? { open: !!layout.open, maximized: !!layout.open && !!layout.maximized } : undefined;
}

export function saveMapLayout(id: string, layout: MapLayout) {
    try {
        const all = readAll();
        // Last in the object, so it's the last to be forgotten
        delete all[id];
        all[id] = layout;
        const ids = Object.keys(all);
        for (const old of ids.slice(0, Math.max(0, ids.length - LIMIT))) delete all[old];
        localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
        // Not kept: the map's closed next time
    }
}

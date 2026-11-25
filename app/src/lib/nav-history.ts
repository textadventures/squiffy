// Back and Forward (#678): the places the author has jumped from, in the script or in the section
// written beside the map, as a browser keeps the pages it's been to. A jump is going somewhere
// on purpose (a link's definition, the outline, a problem, a search result, another tab, a box on
// the map), not moving the cursor about. Each place is a file and an offset, kept in step with
// edits, so it's still the same text after some's been added above it.

import type { ChangeDesc, Text } from "@codemirror/state";

export interface Place {
    file: string;
    offset: number;
}

// Enough to find the way back, without keeping every place visited in a long session
export const HISTORY_LIMIT = 50;

const same = (a: Place, b: Place) => a.file === b.file && a.offset === b.offset;

export class NavHistory {
    private back: Place[] = [];
    private forward: Place[] = [];

    // Told whenever there's somewhere new to go back or forward to, or not
    constructor(private readonly onChange: () => void = () => {}) {}

    get canGoBack() {
        return this.back.length > 0;
    }

    get canGoForward() {
        return this.forward.length > 0;
    }

    // Before a jump: where the author is leaving, which Back comes back to. Going somewhere new
    // forgets where Forward went, as in a browser.
    record(here: Place | null) {
        if (here && !(this.back.length && same(this.back[this.back.length - 1], here))) {
            this.back.push(here);
            if (this.back.length > HISTORY_LIMIT) this.back.shift();
        }
        this.forward = [];
        this.onChange();
    }

    // The place to go back to, with where the author is now kept for Forward. Undefined if
    // there's nowhere to go. A place that's where the author is already is passed over.
    goBack(here: Place | null): Place | undefined {
        return this.step(this.back, this.forward, here);
    }

    goForward(here: Place | null): Place | undefined {
        return this.step(this.forward, this.back, here);
    }

    private step(from: Place[], to: Place[], here: Place | null): Place | undefined {
        let place = from.pop();
        while (place && here && same(place, here)) place = from.pop();
        if (place && here) to.push(here);
        this.onChange();
        return place;
    }

    // A file's text changed: its places move with the text they were at. A place whose whole
    // line was deleted (as when a section's deleted) is forgotten; one in text that was only
    // replaced, such as a name that was renamed, stays where it was.
    mapChanges(file: string, changes: ChangeDesc, before: Text) {
        const map = (places: Place[]) => places.flatMap(place => {
            if (place.file !== file) return [place];
            const offset = Math.min(place.offset, before.length);
            const line = before.lineAt(offset);
            let deleted = false;
            changes.iterChangedRanges((fromA, toA) => {
                if (fromA <= line.from && toA >= line.to && (fromA < line.from || toA > line.to)) deleted = true;
            });
            return deleted ? [] : [{ file, offset: changes.mapPos(offset, -1) }];
        });
        const lengths = [this.back.length, this.forward.length];
        this.back = map(this.back);
        this.forward = map(this.forward);
        if (lengths[0] !== this.back.length || lengths[1] !== this.forward.length) this.onChange();
    }

    renameFile(from: string, to: string) {
        for (const place of [...this.back, ...this.forward]) {
            if (place.file === from) place.file = to;
        }
    }

    // A file that's been deleted
    forgetFile(file: string) {
        this.back = this.back.filter(p => p.file !== file);
        this.forward = this.forward.filter(p => p.file !== file);
        this.onChange();
    }
}

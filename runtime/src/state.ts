import {startsWith} from "./utils.js";

export class State {
    persist: boolean;
    storyId: string;
    onSet: (attribute: string, value: any) => void;
    storageFallback: Record<string, string> = {};

    constructor(persist: boolean,
                storyId: string,
                onSet: (attribute: string, value: any) => void) {
        this.persist = persist;
        this.storyId = storyId;
        this.onSet = onSet;
    }

    set(attribute: string, value: any) {
        if (typeof value === 'undefined') value = true;
        if (this.persist && window.localStorage) {
            localStorage[this.storyId + '-' + attribute] = JSON.stringify(value);
        }
        else {
            this.storageFallback[attribute] = JSON.stringify(value);
        }
        this.onSet(attribute, value);
    }

    get(attribute: string): any {
        let result;
        if (this.persist && window.localStorage) {
            result = localStorage[this.storyId + '-' + attribute];
        }
        else {
            result = this.storageFallback[attribute];
        }
        if (!result) return null;
        return JSON.parse(result);
    }

    reset() {
        if (this.persist && window.localStorage && this.storyId) {
            const keys = Object.keys(localStorage);
            for (const key of keys) {
                if (startsWith(key, this.storyId)) {
                    localStorage.removeItem(key);
                }
            }
        }
        else {
            this.storageFallback = {};
        }
    }

    setSeen(sectionName: string) {
        let seenSections = this.get('_seen_sections');
        if (!seenSections) seenSections = [];
        if (seenSections.indexOf(sectionName) == -1) {
            seenSections.push(sectionName);
            this.set('_seen_sections', seenSections);
        }
    }

    getSeen(sectionName: string) {
        const seenSections = this.get('_seen_sections');
        if (!seenSections) return false;
        return (seenSections.indexOf(sectionName) > -1);
    }
}
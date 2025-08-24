export class State {
    persist: boolean;
    storyId: string;
    onSet: (attribute: string, value: any) => void;
    store: Record<string, any> = {};

    constructor(persist: boolean,
                storyId: string,
                onSet: (attribute: string, value: any) => void) {
        this.persist = persist;
        this.storyId = storyId;
        this.onSet = onSet;
    }

    private usePersistentStorage() {
        return this.persist && window.localStorage && this.storyId;
    }

    set(attribute: string, value: any) {
        if (typeof value === 'undefined') value = true;

        this.store[attribute] = structuredClone(value);

        if (this.usePersistentStorage()) {
            localStorage[this.storyId + '-' + attribute] = JSON.stringify(value);
        }

        this.onSet(attribute, value);
    }

    get(attribute: string): any {
        if (attribute in this.store) {
            return structuredClone(this.store[attribute]);
        }

        return null;
    }

    load() {
        if (!this.usePersistentStorage()) {
            return;
        }

        const keys = Object.keys(localStorage);
        for (const key of keys) {
            if (key.startsWith(this.storyId + '-')) {
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
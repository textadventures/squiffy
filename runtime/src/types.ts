import { SquiffyEventHandler, SquiffyEventMap } from "./events.js";

export interface SquiffyInitOptions {
    element: HTMLElement;
    story: Story;
    scroll?: string,
    persist?: boolean,
    storyId?: string,
    onSet?: (attribute: string, value: any) => void,
    /**
     * Maps an asset path used in the story (e.g. "cat.png" in an img src) to the URL it should be
     * loaded from. Applied to src, srcset and poster attributes, and url() in inline styles, of
     * rendered output. Absolute URLs (http:, https:, data:, blob: etc. and protocol-relative) are
     * left alone. When not provided, paths are used as they are.
     */
    resolveAssetUrl?: (path: string) => string,
}

export interface SquiffySettings {
    scroll: string,
    persist: boolean,
    onSet: (attribute: string, value: any) => void,
}

// Where to start a story, instead of its start section or a saved game
export interface StartAt {
    section: string;
    // A passage in that section, shown after the section
    passage?: string;
}

export interface SquiffyApi {
    // Starts the story: from startAt if it's given (ignoring any saved game), otherwise from the
    // saved game, or the story's start section.
    begin: (startAt?: StartAt) => Promise<void>;
    restart: () => void;
    get: (attribute: string) => any;
    set: (attribute: string, value: any) => void;
    clickLink: (link: HTMLElement) => Promise<boolean>;
    update: (story: Story) => void;
    goBack: () => void;

    on<E extends keyof SquiffyEventMap>(
        event: E,
        handler: SquiffyEventHandler<E>
    ): () => void; // returns unsubscribe

    off<E extends keyof SquiffyEventMap>(
        event: E,
        handler: SquiffyEventHandler<E>
    ): void;

    once<E extends keyof SquiffyEventMap>(
        event: E,
        handler: SquiffyEventHandler<E>
    ): () => void;
}

// Previous versions of Squiffy had "squiffy", "get" and "set" as globals - we now pass these directly into JS functions.
// We may tidy up this API at some point, though that would be a breaking change.
interface SquiffyJsFunctionApi {
    get: (attribute: string) => any;
    set: (attribute: string, value: any) => void;
    ui: {
        transition: (f: any) => void;
    };
    story: {
        go: (section: string) => void;
        seen: (sectionOrPassage: string) => boolean;
    };
}

export interface Story {
    js: ((
        squiffy: SquiffyJsFunctionApi,
        get: (attribute: string) => any,
        set: (attribute: string, value: any) => void
    ) => void)[];
    start: string;
    id?: string | null;
    uiJsIndex?: number;
    sections: Record<string, Section>;
}

export interface Section {
    text?: string;
    clear?: boolean;
    attributes?: string[],
    jsIndex?: number;
    passages?: Record<string, Passage>;
    passageCount?: number;
}

export interface Passage {
    text?: string;
    clear?: boolean;
    attributes?: string[];
    jsIndex?: number;
}
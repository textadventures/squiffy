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
    // Whether goBack() would go anywhere, e.g. to enable a Back button. canGoBackChanged says when it changes.
    canGoBack: () => boolean;
    // The game as it is now, to keep and load again later with loadSave()
    getSave: () => SavedGame;
    // Carries on from a saved game, in place of the game as it is now. A save from a different
    // story (by its squiffy.json "id") isn't loaded.
    loadSave: (save: SavedGame) => Promise<LoadSaveResult>;

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
        visits: (sectionOrPassage: string) => number;
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
    // squiffy.json's "id", which a saved game is checked against
    projectId?: string;
    uiJsIndex?: number;
    // Whether @set and link setters take expressions, with the same rules as {{#if}}: attributes
    // by name, and text in quotes. True for a story with a squiffy.json (#373).
    expressions?: boolean;
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
    // @repeat: its links stay clickable, and clicking one doesn't count towards @1, @2... and @last (#104)
    repeat?: boolean;
    attributes?: string[];
    jsIndex?: number;
}
// A saved game, from SquiffyApi.getSave(). It's JSON, so it can be kept as text or in a file.
export interface SavedGame {
    format: "squiffy-save";
    version: 1;
    // The story's squiffy.json "id", if it has one
    storyId: string | null;
    // Where the player was
    section: string | null;
    passage: string | null;
    // The start of the text the player was reading, to tell saves apart by
    summary: string;
    // When it was saved, as an ISO date
    savedAt: string;
    // Every attribute, including the text on screen (_output)
    state: Record<string, unknown>;
}

export type LoadSaveResult =
    | { success: true }
    // notASave: it isn't a saved game, or it's from a newer version of Squiffy.
    // wrongStory: it's from a different story.
    | { success: false; error: "notASave" | "wrongStory" };

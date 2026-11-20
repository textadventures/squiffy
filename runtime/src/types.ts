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
    /**
     * The page's text, for a story in another language: squiffy.json's "strings", by the same
     * names. Used for the text of {{restart}} and {{saves}} links (#452), and the dialogs they
     * open when the page doesn't handle them itself. Anything left out is in English.
     */
    strings?: Partial<Record<string, string>>,
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
    // A passage in the master section [[]], rendered as HTML with the attributes as they are now,
    // for a panel beside the story or a dialog (#14, #443). It changes nothing: {{set}} and the
    // like are ignored, its @set and JavaScript don't run, and its links are disabled.
    renderPassage: (name: string) => string;
    // Whether the story's music and sounds are muted (#444). It's remembered for the story when
    // persist is on, like the light or dark theme.
    isMuted: () => boolean;
    setMuted: (muted: boolean) => void;
    // Whether the story plays music or sounds: it names some files, or has played one. The
    // "sound" event says when something plays.
    usesSound: () => boolean;
    // The story's player settings (squiffy.json's "settings", #452), which the Settings dialog shows
    getSettings: () => PlayerSetting[];
    // A setting's value, as the story reads it with settings.name: its default if the player
    // hasn't changed it
    getSetting: (name: string) => SettingValue | null;
    // Changes a setting, as the player does in the Settings dialog. A value that isn't one the
    // setting can have is ignored. It's remembered for the story when persist is on, and going
    // back, restarting or loading a saved game doesn't change it.
    setSetting: (name: string, value: SettingValue) => void;
    // Puts every setting back to its default
    resetSettings: () => void;
    // Stops the story's music and sounds for good, when it's being replaced, e.g. in the editor's preview
    dispose: () => void;

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
    // The sound files the story names (#444), to load before they're needed
    audio?: string[];
    // Whether @set and link setters take expressions, with the same rules as {{#if}}: attributes
    // by name, and text in quotes. True for a story with a squiffy.json (#373).
    expressions?: boolean;
    // squiffy.json's "panels": passages shown beside the story, or in a dialog from a button
    panels?: Panel[];
    // squiffy.json's "settings": options the player can change, which the story reads as settings.name
    settings?: PlayerSetting[];
    sections: Record<string, Section>;
}

// The icons a panel's button can have, in place of its label
export const PANEL_ICONS = ["bag", "person", "map", "help", "info", "list", "book", "star", "heart"] as const;
export type PanelIcon = typeof PANEL_ICONS[number];

// A passage in the master section that's always on screen, rendered again as the story goes on:
// beside the story ("side"), or in a dialog that a button in the header opens ("button").
export interface Panel {
    passage: string;
    // The button's text, or its tooltip if it has an icon. A side panel's button only shows on
    // screens too narrow for the panel.
    label: string;
    // "button" if it's left out
    position?: "side" | "button";
    icon?: PanelIcon;
}

// A player setting (#452), from squiffy.json's "settings": "toggle" is on or off, "list" is one of
// its options, and "range" a number from min to max
export type PlayerSetting =
    | PlayerSettingBase & { type: "toggle"; default?: boolean }
    | PlayerSettingBase & { type: "list"; options: PlayerSettingOption[]; default?: string }
    | PlayerSettingBase & { type: "range"; min: number; max: number; step?: number; default?: number };

interface PlayerSettingBase {
    // How the story refers to it: settings.name
    name: string;
    // What the Settings dialog calls it
    label: string;
    // More about it, shown under the label
    description?: string;
}

export interface PlayerSettingOption {
    // What the story reads
    value: string;
    // What the Settings dialog shows
    label: string;
}

export type SettingValue = boolean | string | number;

export interface Section {
    text?: string;
    clear?: boolean;
    // @music (#444): the file to play, or null to stop it
    music?: string | null;
    // @sound: files to play once, in order, with "stop" for @sound stop
    sounds?: string[];
    // @class (#449): classes on the story's element while this is the current section
    classes?: string[];
    // @transition (#489): how it appears, or "none", and how long that takes in milliseconds
    transition?: string;
    transitionTime?: number;
    // @leave: how the old text goes when this clears the screen, or "none", and how long that takes
    leave?: string;
    leaveTime?: number;
    attributes?: string[],
    jsIndex?: number;
    passages?: Record<string, Passage>;
    passageCount?: number;
}

export interface Passage {
    text?: string;
    clear?: boolean;
    // @music (#444): the file to play, or null to stop it
    music?: string | null;
    // @sound: files to play once, in order, with "stop" for @sound stop
    sounds?: string[];
    // @class (#449): classes added to the section's when this passage is shown
    classes?: string[];
    // @transition (#489): how it appears, or "none", and how long that takes in milliseconds
    transition?: string;
    transitionTime?: number;
    // @leave: how the old text goes when this clears the screen, or "none", and how long that takes
    leave?: string;
    leaveTime?: number;
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

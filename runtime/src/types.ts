import { SquiffyEventHandler, SquiffyEventMap } from "./events.js";

export interface SquiffyInitOptions {
    element: HTMLElement;
    story: Story;
    // How the page scrolls as text is added: "body" (the default) scrolls the page, "element" the
    // story's element, and "none" doesn't scroll
    scroll?: "body" | "element" | "none",
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
    /**
     * The values of the story's persistent attributes (squiffy.json's "persistent", #539) to start
     * with, in place of those kept in the browser: e.g. the CLI's --play carrying them from one run
     * to the next. getPersistent() gives them back.
     */
    persistent?: Record<string, unknown>,
}

export interface SquiffySettings {
    scroll: "body" | "element" | "none",
    persist: boolean,
    onSet: (attribute: string, value: any) => void,
}

// Where to start a story, instead of its start section or a saved game
export interface StartAt {
    section: string;
    // A passage in that section, shown after the section
    passage?: string;
    // Attributes to set first, as @set would: "score = 5", "has_key", "not seen_intro"
    set?: string[];
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
    // The values of the story's persistent attributes (squiffy.json's "persistent", #539), by
    // name: those the story has set. They aren't in getSave(), as loading a game leaves them alone.
    getPersistent: () => Record<string, unknown>;
    // The title for the page's header, at its left: the one the story set with {{headertitle}}, or
    // else the story's @title if squiffy.json has "headerTitle": true. "" for none. The
    // headerTitleChanged event says when it changes.
    headerTitle: () => string;
    // Clears persistent attributes, as {{forget}} does: the ones named, or all of them
    forget: (names?: string[]) => void;
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

// The events a story's own scripts can listen for (#528). The others are for the page around the
// story: a handler for restartRequested, say, would stop the page asking before restarting.
export type SquiffyScriptEvent = "navigated" | "set" | "settingChanged";

// What a story's own scripts (.js files added to the page, or @import-ed) get with the
// squiffy:ready event, which the story's element sends, bubbling up to document, when the story
// has been set up and before it starts (#528):
//
//     document.addEventListener("squiffy:ready", ({ detail: squiffy }) => {
//         squiffy.on("navigated", ({ section }) => { ... });
//     });
//
// Its get, set and story are the same as a section's JavaScript gets.
export interface SquiffyScriptApi {
    get: (attribute: string) => any;
    set: (attribute: string, value: any) => void;
    story: {
        go: (section: string) => Promise<void>;
        seen: (sectionOrPassage: string) => boolean;
        visits: (sectionOrPassage: string) => number;
        // How many turns ago it was last visited: 0 if the player is there now, -1 if never (#540)
        lastVisited: (sectionOrPassage: string) => number;
        passages: (section?: string, filter?: TagFilter) => string[];
        sections: (filter?: TagFilter) => string[];
        tags: (name?: string) => string[];
    };
    // A player setting's value (squiffy.json's "settings"), as the story reads it with settings.name
    getSetting: (name: string) => SettingValue | null;
    // The story's element
    element: HTMLElement;
    on<E extends SquiffyScriptEvent>(event: E, handler: SquiffyEventHandler<E>): () => void;
    off<E extends SquiffyScriptEvent>(event: E, handler: SquiffyEventHandler<E>): void;
    once<E extends SquiffyScriptEvent>(event: E, handler: SquiffyEventHandler<E>): () => void;
}

// What a section's or passage's JavaScript gets as squiffy, with get and set on their own too, as
// Squiffy 5 had them as globals. It's the API documented on the docs' JavaScript page
// (site/src/content/docs/javascript.mdx), so it can only be added to in 7.x. @ui code gets
// registerHelper, registerAnimation and SafeString as well.
interface SquiffyJsFunctionApi {
    get: (attribute: string) => any;
    set: (attribute: string, value: any) => void;
    ui: {
        // Runs a transition effect: links can't be clicked until fn's Promise resolves
        transition: (fn: () => Promise<void>) => void;
        write: (text: string, source?: string) => void;
        scrollToEnd: () => void;
        // Runs fn once the section's or passage's text is on the page (#106)
        afterWrite: (fn: () => void) => void;
    };
    // The story's element
    element: HTMLElement;
    story: {
        // Goes to a section. From an afterWrite function, once the text has been written, as {{goto}} does.
        go: (section: string) => Promise<void>;
        seen: (sectionOrPassage: string) => boolean;
        visits: (sectionOrPassage: string) => number;
        // How many turns ago it was last visited: 0 if the player is there now, -1 if never (#540)
        lastVisited: (sectionOrPassage: string) => number;
        // The passages of a section ("" for the master section), or with no section, the
        // current section's and the master section's, leaving out @1, @last and @after (#527)
        passages: (section?: string, filter?: TagFilter) => string[];
        // The story's sections, apart from the master section
        sections: (filter?: TagFilter) => string[];
        // A passage's or section's @tag tags, or the current section's
        tags: (name?: string) => string[];
    };
}

// Which sections or passages squiffy.story.passages() and sections() list, by their @tag tags (#527)
export interface TagFilter {
    // Only those with all of these tags (separated by spaces, or a list)
    tagged?: string | string[];
    // Only those with none of these tags
    untagged?: string | string[];
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
    // squiffy.json's "persistent": attributes that belong to the player rather than the
    // playthrough (#539). Restarting, going back and loading a saved game leave them as they are.
    persistent?: string[];
    // The story's @title, if squiffy.json's "headerTitle" shows it in the page's header
    headerTitle?: string;
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
    // @test: a section for testing the story, which the Start at menu lists first
    test?: boolean;
    text?: string;
    clear?: boolean;
    // @music (#444): the file to play, or null to stop it
    music?: string | null;
    // @sound: files to play once, in order, with "stop" for @sound stop
    sounds?: string[];
    // @class (#449): classes on the story's element while this is the current section
    classes?: string[];
    // @tag (#527): tags the story can list sections by
    tags?: string[];
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
    // @tag (#527): tags the story can list passages by
    tags?: string[];
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
// Its version only goes up when an earlier runtime couldn't load it: anything added to it in 7.x
// is something an earlier 7.x can do without, and leaves alone (#642).
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
    // notASave: it isn't a saved game.
    // newerSave: it's from a newer version of Squiffy, which saves games in a way this one can't load.
    // wrongStory: it's from a different story.
    | { success: false; error: "notASave" | "newerSave" | "wrongStory" };

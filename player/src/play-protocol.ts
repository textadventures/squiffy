// The messages between the editor and the play page (play.ts), which plays the editor's story for
// Play in a new tab (#644). The story is someone's JavaScript, so it runs here, on the player's
// domain, rather than in a tab of the editor's own, where it could reach the editor's storage.
//
// The editor opens the play page, which tells it it's ready; the editor then sends the story's
// published page (the exporter's single index.html), which the play page becomes. Only this
// handshake is in the play page: the runtime is in the page the editor sends, so the play page
// stays the same from one release of the editor to the next.

export const PLAY_CHANNEL = "squiffy-play";
// Which version of these messages the sender speaks, so they can change later
export const PLAY_PROTOCOL = 1;

export type PlayMessage =
    // From the play page to the editor that opened it. It carries nothing, so it can go to any origin.
    | { channel: typeof PLAY_CHANNEL; type: "ready"; version: number }
    // From the editor, sent only to the player's origin
    | { channel: typeof PLAY_CHANNEL; type: "play"; version: number; html: string };

export const readyMessage = (): PlayMessage => ({ channel: PLAY_CHANNEL, type: "ready", version: PLAY_PROTOCOL });
export const playMessage = (html: string): PlayMessage => ({ channel: PLAY_CHANNEL, type: "play", version: PLAY_PROTOCOL, html });

const isMessage = (data: unknown, type: string): data is Record<string, unknown> =>
    typeof data === "object" && data !== null
    && (data as { channel?: unknown }).channel === PLAY_CHANNEL
    && (data as { type?: unknown }).type === type
    && typeof (data as { version?: unknown }).version === "number";

export const isReadyMessage = (data: unknown): boolean => isMessage(data, "ready");

/** The page in a play message, or null if it isn't one */
export function storyInPlayMessage(data: unknown): string | null {
    return isMessage(data, "play") && typeof data.html === "string" ? data.html : null;
}

// The editors that can send a story to play: the stable and beta editors, and the beta's preview
// deployments for pull requests on Cloudflare Pages (squiffy.pages.dev), which only this repo's
// own branches get. Anywhere else could put a page of its own on the player's domain, where the
// stories played here keep their saves.
const EDITORS: (string | RegExp)[] = [
    "https://app.squiffystory.com",
    "https://app-beta.squiffystory.com",
    /^https:\/\/[a-z0-9-]+\.squiffy\.pages\.dev$/,
];
// And, in development, an editor on this machine
const DEV_EDITORS: RegExp[] = [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

export function isEditorOrigin(origin: string, dev = false): boolean {
    return [...EDITORS, ...(dev ? DEV_EDITORS : [])].some(e => typeof e === "string" ? e === origin : e.test(origin));
}

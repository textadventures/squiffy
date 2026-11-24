// Play in a new tab, in a browser: the published story plays on the player's domain, in its play
// page (player/src/play.ts), rather than in a tab of the editor's own (#644). The story is
// someone's JavaScript, and in a tab the editor opened itself, from a blob: URL, it would have the
// editor's origin: the stories kept in this browser, and the folders it's been allowed to use.
// The desktop app plays it in a window of its own instead (desktop/src/story-window.ts).
//
// The tab is opened during the click, so a popup blocker lets it through, and the play page says
// when it's ready, which can be before the story is ready to send.
import { isReadyMessage, playMessage } from "@textadventures/squiffy-player/play-protocol";
import { PLAYER_ORIGIN, playerUrl } from "./share-link.js";

export const playPageUrl = (version: string) => `${playerUrl(version)}play`;

// How long the play page has to load once the story is ready to send
const READY_TIMEOUT_MS = 20_000;

export interface PlayTab {
    /** Sends the story's published page (the exporter's single index.html) once the play page is ready */
    play(html: string): Promise<void>;
    close(): void;
}

type MessageHost = Pick<Window, "addEventListener" | "removeEventListener">;

/** Listens for the play page in tab to be ready, from now, and sends it the story when it is */
export function connectPlayTab(tab: Window, host: MessageHost = window, origin = new URL(PLAYER_ORIGIN).origin, timeoutMs = READY_TIMEOUT_MS): PlayTab {
    let isReady!: () => void;
    const ready = new Promise<void>(resolve => { isReady = resolve; });
    const listener = (event: MessageEvent) => {
        if (event.source === tab && event.origin === origin && isReadyMessage(event.data)) isReady();
    };
    host.addEventListener("message", listener);
    const stop = () => host.removeEventListener("message", listener);
    return {
        async play(html) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(tab.closed ? "its tab was closed." : "its tab didn't load.")), timeoutMs);
            });
            try {
                await Promise.race([ready, timeout]);
            } finally {
                clearTimeout(timer);
                stop();
            }
            // Only to the player's origin, so it never goes to a tab that's gone somewhere else
            tab.postMessage(playMessage(html), origin);
        },
        close() {
            stop();
            tab.close();
        },
    };
}

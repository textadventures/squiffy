// The play page (play.html): plays a story the editor sends it, for Play in a new tab (#644). The
// story is someone's JavaScript, so it runs here, on the player's domain, rather than in a tab of
// the editor's own, which would have the editor's origin and storage. The editor opens this page,
// it says it's ready, and the editor sends the story's published page, which this page becomes,
// so the story's saves are kept here as a published story's are. See play-protocol.ts.
import { isEditorOrigin, readyMessage, storyInPlayMessage } from "./play-protocol.ts";

// The story, kept for this tab, so it plays again if the page reloads: its Restart button reloads it
const STORY_KEY = "squiffy-play-story";

function become(html: string) {
    document.open();
    document.write(html);
    document.close();
}

function show(heading: string, text: string) {
    const message = document.getElementById("message")!;
    message.append(Object.assign(document.createElement("h1"), { textContent: heading }));
    message.append(Object.assign(document.createElement("p"), { textContent: text }));
    message.hidden = false;
}

let saved: string | null = null;
try {
    saved = sessionStorage.getItem(STORY_KEY);
} catch {
    // Storage can be unavailable, e.g. in a private window
}

const opener: Window | null = window.opener;
if (saved !== null) {
    become(saved);
} else if (!opener) {
    show("No story here", "This page plays a story from the Squiffy editor, when you choose Play in a new tab there.");
} else {
    window.addEventListener("message", event => {
        if (event.source !== opener || !isEditorOrigin(event.origin, import.meta.env.DEV)) return;
        const html = storyInPlayMessage(event.data);
        if (html === null) return;
        try {
            sessionStorage.setItem(STORY_KEY, html);
        } catch {
            // Too big to keep (its images and sounds are in it), so it won't play again on a reload
        }
        // So the story can't reach the editor's tab, to send it somewhere else or message it
        window.opener = null;
        become(html);
    });
    // Nothing in it, so it can go to whoever opened this page: only an editor gets an answer
    opener.postMessage(readyMessage(), "*");
}

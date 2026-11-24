import { randomUUID } from "node:crypto";
import { BrowserWindow, session, type Session, type WebContents } from "electron";

// Play in a new tab: the published story, in a window of its own (#644). The story is the
// author's JavaScript, or someone else's from a story they opened, so it gets nothing of the
// editor's: its own scheme, so its own origin (story://play), its own session, so its own storage,
// and no preload, so no bridges. A window the editor opened itself would share the editor's origin
// and could reach its bridges through window.opener, and with them the folders on disk.

export const STORY_SCHEME = "story";
const STORY_HOST = "play";
export const STORY_ORIGIN = `${STORY_SCHEME}://${STORY_HOST}`;

// Persistent, so a story's saves are still there the next time it's played
const PARTITION = "persist:story-play";

// The exported page has its images and sounds in it, so it can be big, but not this big
export const MAX_STORY_HTML = 256 * 1024 * 1024;

// Each open window's page, by the id in its address, so the story can reload itself (Restart does)
const pages = new Map<string, string>();
let storySession: Session | undefined;

function getStorySession(): Session {
    if (storySession) return storySession;
    const ses = session.fromPartition(PARTITION);
    ses.protocol.handle(STORY_SCHEME, (request) => {
        const url = new URL(request.url);
        const html = url.host === STORY_HOST ? pages.get(url.pathname.slice(1)) : undefined;
        if (html === undefined) return new Response("Not found", { status: 404 });
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    });
    // A story has no need of the camera, the microphone, notifications and so on, so nothing is
    // asked for: only full screen, which a story's own script might use
    ses.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === "fullscreen"));
    ses.setPermissionCheckHandler((_contents, permission) => permission === "fullscreen");
    storySession = ses;
    return ses;
}

/** Whether these are a story window's contents, which may only navigate within story:// */
export function isStoryContents(contents: WebContents): boolean {
    return !!storySession && contents.session === storySession;
}

export function isStoryUrl(url: string): boolean {
    try {
        return new URL(url).origin === STORY_ORIGIN;
    } catch {
        return false;
    }
}

/** Opens the published story's page (the exporter's single index.html) in a window of its own */
export function openStoryWindow(html: string, icon?: string): void {
    const id = randomUUID();
    pages.set(id, html);
    const win = new BrowserWindow({
        width: 1024,
        height: 768,
        autoHideMenuBar: true,
        ...(icon ? { icon } : {}),
        webPreferences: {
            session: getStorySession(),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });
    win.on("closed", () => pages.delete(id));
    void win.loadURL(`${STORY_ORIGIN}/${id}`);
}

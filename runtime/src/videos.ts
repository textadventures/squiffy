// {{youtube}}: a YouTube video, played in the story.
//
// On a page served over http(s), such as a published story or the CLI's test server, the video is
// embedded in YouTube's player. Where it can't be, it's a link instead, with the video's picture
// and a play button, which opens the video on YouTube in a new tab. That's:
// - the sandboxed preview (the editor, VS Code, the docs' samples that have files, and
//   squiffystories.com's player for shared links), whose frame has an opaque origin. (The docs'
//   other samples run in the docs page itself, so they embed it.) A frame inside it is sandboxed too, so
//   YouTube's player stays black, and the player's Content-Security-Policy allows no frames at all,
//   so that a story shared as a link can't show another site under squiffystories.com's address.
// - a page opened as a file, or in the desktop app's own window, which YouTube won't play in, as
//   it needs to know which site the video is on.

export interface Video {
    id: string;
    // Where to start, in seconds
    start?: number;
}

// The link's text, which squiffy.json's "strings" can replace as "watchOnYouTube" (PAGE_STRINGS
// in the compiler's project.ts has it too)
export const WATCH_ON_YOUTUBE = "Watch on YouTube";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

// "90", "90s", "1m30s", "1h2m3s" or "1:30", as YouTube's t= and the helper's start= take them
export function parseStart(value: unknown): number | undefined {
    if (typeof value == "number") return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
    if (typeof value != "string") return undefined;
    const text = value.trim();
    let seconds: number | undefined;
    if (/^\d+(\.\d+)?s?$/.test(text)) {
        seconds = parseFloat(text);
    } else if (/^\d+(:\d{1,2}){1,2}$/.test(text)) {
        seconds = text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
    } else {
        const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
        if (match && text) seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
    }
    return seconds !== undefined && seconds > 0 ? Math.floor(seconds) : undefined;
}

function parseUrl(text: string): URL | undefined {
    try {
        return new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : "https://" + text);
    } catch {
        return undefined;
    }
}

// A YouTube video from its id, or the address of its page, a youtu.be link, or an embed, Shorts
// or live address
export function parseYouTube(value: string): Video | undefined {
    const text = value.trim();
    if (YOUTUBE_ID.test(text)) return { id: text };
    const url = parseUrl(text);
    if (!url) return undefined;
    const host = url.hostname.replace(/^(www|m|music)\./, "");
    let id: string | undefined;
    if (host == "youtu.be") {
        id = url.pathname.split("/")[1];
    } else if (host == "youtube.com" || host == "youtube-nocookie.com") {
        const path = url.pathname.split("/").filter(Boolean);
        id = path[0] == "watch" ? url.searchParams.get("v") ?? undefined
            : ["embed", "shorts", "live", "v"].includes(path[0]) ? path[1] : undefined;
    }
    if (!id || !YOUTUBE_ID.test(id)) return undefined;
    const start = parseStart(url.searchParams.get("t") ?? url.searchParams.get("start") ?? undefined);
    return { id, ...(start ? { start } : {}) };
}

// The video's own page, which the link opens
export function watchUrl(video: Video): string {
    return `https://www.youtube.com/watch?v=${video.id}` + (video.start ? `&t=${video.start}s` : "");
}

// The player to embed, from youtube-nocookie.com, which leaves no cookies until the video is played
export function embedUrl(video: Video): string {
    return `https://www.youtube-nocookie.com/embed/${video.id}` + (video.start ? `?start=${video.start}` : "");
}

// The video's picture, for the link
export function thumbnailUrl(video: Video): string {
    return `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
}

// Whether a video can be embedded on this page: it must be served over http(s), and not from a
// sandboxed frame, whose origin is opaque ("null")
export function canEmbedVideos(win: Window = window): boolean {
    try {
        const protocol = win.location.protocol;
        return (protocol == "http:" || protocol == "https:") && win.origin != "null";
    } catch {
        return false;
    }
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export interface VideoHtmlOptions {
    // The video's name, for a screen reader, the frame's title and the link's text
    title?: string;
    // Embed the video, rather than linking to it
    embed: boolean;
    // The link's text
    watchText: string;
}

// The video's HTML. It's spans, shown as blocks, as it may be in a paragraph.
export function videoHtml(video: Video, options: VideoHtmlOptions): string {
    const title = options.title?.trim() || "YouTube video";
    if (options.embed) {
        return `<span class="squiffy-video"><iframe src="${escapeHtml(embedUrl(video))}" title="${escapeHtml(title)}"`
            + " allow=\"autoplay; encrypted-media; fullscreen; picture-in-picture; web-share\" allowfullscreen"
            + " referrerpolicy=\"strict-origin-when-cross-origin\" loading=\"lazy\"></iframe></span>";
    }
    return `<a class="squiffy-video squiffy-video-link" href="${escapeHtml(watchUrl(video))}" target="_blank" rel="noopener noreferrer">`
        + `<img src="${escapeHtml(thumbnailUrl(video))}" alt="" loading="lazy">`
        + "<span class=\"squiffy-video-play\" aria-hidden=\"true\"></span>"
        + `<span class="squiffy-video-caption">${options.title?.trim() ? `<span class="squiffy-video-title">${escapeHtml(title)}</span> ` : ""}`
        + `<span class="squiffy-video-watch">${escapeHtml(options.watchText)}</span></span></a>`;
}

// {{youtube}} and {{vimeo}}: a video from YouTube or Vimeo, played in the story.
//
// On a page served over http(s), such as a published story or the CLI's test server, the video is
// embedded in a frame from the site. Where it can't be, it's a link instead, with the video's
// picture and a play button, which opens the video on its site in a new tab. That's:
// - the sandboxed preview (the editor, VS Code, the docs' samples and squiffystories.com's player
//   for shared links), whose frame has an opaque origin. A frame inside it is sandboxed too, so
//   YouTube's player stays black, and the player's Content-Security-Policy allows no frames at all,
//   so that a story shared as a link can't show another site under squiffystories.com's address.
// - a page opened as a file, or in the desktop app's own window, which YouTube won't play in, as
//   it needs to know which site the video is on.

export type VideoSite = "youtube" | "vimeo";

export interface Video {
    site: VideoSite;
    id: string;
    // Vimeo's private videos have a hash after the id, which the link and the embed both need
    hash?: string;
    // Where to start, in seconds
    start?: number;
}

// The link's text, which squiffy.json's "strings" can replace as "watchVideo" (PAGE_STRINGS in
// the compiler's project.ts has it too)
export const WATCH_VIDEO = "Watch on [site]";

const SITE_NAMES: Record<VideoSite, string> = { youtube: "YouTube", vimeo: "Vimeo" };

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
    if (YOUTUBE_ID.test(text)) return { site: "youtube", id: text };
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
    return { site: "youtube", id, ...(start ? { start } : {}) };
}

// A Vimeo video from its number, or the address of its page or its player
export function parseVimeo(value: string): Video | undefined {
    const text = value.trim();
    if (/^\d+$/.test(text)) return { site: "vimeo", id: text };
    const url = parseUrl(text);
    if (!url) return undefined;
    const host = url.hostname.replace(/^www\./, "");
    if (host != "vimeo.com" && host != "player.vimeo.com") return undefined;
    const path = url.pathname.split("/").filter(Boolean);
    // vimeo.com/123, vimeo.com/123/abc (a private video), player.vimeo.com/video/123?h=abc, and
    // pages such as vimeo.com/channels/staffpicks/123, where the video's number comes last
    const index = path[0] == "video" ? 1 : path.findLastIndex(part => /^\d+$/.test(part));
    const id = path[index];
    if (!id || !/^\d+$/.test(id)) return undefined;
    const after = path[index + 1];
    const hash = url.searchParams.get("h") ?? (after && /^[0-9a-f]+$/i.test(after) ? after : undefined);
    const start = parseStart(/^#t=(.+)$/.exec(url.hash)?.[1]);
    return { site: "vimeo", id, ...(hash ? { hash } : {}), ...(start ? { start } : {}) };
}

// The video's own page, which the link opens
export function watchUrl(video: Video): string {
    if (video.site == "youtube") {
        return `https://www.youtube.com/watch?v=${video.id}` + (video.start ? `&t=${video.start}s` : "");
    }
    return `https://vimeo.com/${video.id}` + (video.hash ? `/${video.hash}` : "") + (video.start ? `#t=${video.start}s` : "");
}

// The player to embed. YouTube's is from youtube-nocookie.com, which leaves no cookies until the
// video is played, and Vimeo's has dnt=1, which leaves none at all.
export function embedUrl(video: Video): string {
    if (video.site == "youtube") {
        return `https://www.youtube-nocookie.com/embed/${video.id}` + (video.start ? `?start=${video.start}` : "");
    }
    const params = new URLSearchParams();
    if (video.hash) params.set("h", video.hash);
    params.set("dnt", "1");
    return `https://player.vimeo.com/video/${video.id}?${params}` + (video.start ? `#t=${video.start}s` : "");
}

// The video's picture, for the link. Vimeo's can only be found by asking its API, which a story in
// the player can't do, so a Vimeo link has a plain background.
export function thumbnailUrl(video: Video): string | undefined {
    return video.site == "youtube" ? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg` : undefined;
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
    // The link's text, with [site] for YouTube or Vimeo
    watchText: string;
}

// The video's HTML. It's spans, shown as blocks, as it may be in a paragraph.
export function videoHtml(video: Video, options: VideoHtmlOptions): string {
    const siteName = SITE_NAMES[video.site];
    const title = options.title?.trim() || `${siteName} video`;
    const classes = `squiffy-video squiffy-video-${video.site}`;
    if (options.embed) {
        return `<span class="${classes}"><iframe src="${escapeHtml(embedUrl(video))}" title="${escapeHtml(title)}"`
            + " allow=\"autoplay; encrypted-media; fullscreen; picture-in-picture; web-share\" allowfullscreen"
            + " referrerpolicy=\"strict-origin-when-cross-origin\" loading=\"lazy\"></iframe></span>";
    }
    const watch = options.watchText.replaceAll("[site]", siteName);
    const thumbnail = thumbnailUrl(video);
    return `<a class="${classes} squiffy-video-link" href="${escapeHtml(watchUrl(video))}" target="_blank" rel="noopener noreferrer">`
        + (thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="" loading="lazy">` : "")
        + "<span class=\"squiffy-video-play\" aria-hidden=\"true\"></span>"
        + `<span class="squiffy-video-caption">${options.title?.trim() ? `<span class="squiffy-video-title">${escapeHtml(title)}</span> ` : ""}`
        + `<span class="squiffy-video-watch">${escapeHtml(watch)}</span></span></a>`;
}

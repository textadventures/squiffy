// Publishing a story to textadventures.co.uk from the editor. The editor has no login there, so it
// uploads the published story with no credentials and is given a page on textadventures.co.uk for
// the author to open (the claim URL), where their own login finishes publishing it. The editor
// then asks what became of the upload, to say when it's published.
// The site's side is textadventures.co.uk's PublishApiController, and its docs/one-click-publish.md
// has the design.
import { desktopApi } from "./desktop.js";

// VITE_PUBLISH_API_URL points a development build at a local copy of textadventures.co.uk
export const PUBLISH_API_URL: string = import.meta.env.VITE_PUBLISH_API_URL || "https://textadventures.co.uk/api/publish/uploads";

// The site's limit, checked here first so a story that's too big isn't uploaded to be refused
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export interface PublishClient {
    source: "web" | "electron";
    version: string;
    platform?: string;
}

// Which editor is publishing, as for the home page's featured games
export function publishClient(): PublishClient {
    const api = desktopApi();
    return { source: api ? "electron" : "web", version: __APP_VERSION__, platform: api?.desktop.platform };
}

export function uploadUrl(base: string, filename: string, client: PublishClient): string {
    const url = new URL(base);
    url.searchParams.set("filename", filename);
    url.searchParams.set("source", client.source);
    url.searchParams.set("version", client.version);
    if (client.platform) url.searchParams.set("platform", client.platform);
    return url.toString();
}

export function statusUrl(base: string, id: string): string {
    return `${base.replace(/\/$/, "")}/${encodeURIComponent(id)}`;
}

export interface Upload {
    id: string;
    // The page on textadventures.co.uk where the author finishes publishing
    claimUrl: string;
}

const isHttpUrl = (value: unknown): value is string => {
    if (typeof value !== "string") return false;
    try {
        return ["https:", "http:"].includes(new URL(value).protocol);
    } catch {
        return false;
    }
};

// The site's answer to an upload, or null if it isn't as expected. The claim URL is opened, so it
// has to be a web page.
export function parseUpload(data: unknown): Upload | null {
    const upload = data as { id?: unknown; claimUrl?: unknown } | null;
    if (!upload || typeof upload.id !== "string" || !upload.id || !isHttpUrl(upload.claimUrl)) return null;
    return { id: upload.id, claimUrl: upload.claimUrl };
}

// Why an upload was refused, for the author
export function uploadError(status: number): string {
    switch (status) {
        case 413:
            return "The story is too big to publish this way. textadventures.co.uk takes stories up to 50 MB.";
        case 429:
            return "You've published a lot in the last hour. Wait a while, then try again.";
        case 0:
            return "Couldn't reach textadventures.co.uk. Check you're online, then try again.";
        default:
            return `textadventures.co.uk couldn't take the story (error ${status}). Try again later.`;
    }
}

export class UploadError extends Error {}

// Uploads the published story (the zip). XMLHttpRequest, as fetch can't say how far an upload has got.
export function uploadStory(
    zip: Uint8Array,
    filename: string,
    client: PublishClient,
    options: { onprogress?: (fraction: number) => void; signal?: AbortSignal; base?: string } = {},
): Promise<Upload> {
    return new Promise((resolve, reject) => {
        if (zip.byteLength > MAX_UPLOAD_BYTES) {
            reject(new UploadError(uploadError(413)));
            return;
        }
        const request = new XMLHttpRequest();
        request.open("POST", uploadUrl(options.base ?? PUBLISH_API_URL, filename, client));
        request.setRequestHeader("Content-Type", "application/octet-stream");
        request.responseType = "json";
        request.upload.onprogress = e => {
            if (e.lengthComputable) options.onprogress?.(e.loaded / e.total);
        };
        request.onload = () => {
            if (request.status !== 201) {
                reject(new UploadError(uploadError(request.status)));
                return;
            }
            const upload = parseUpload(request.response);
            if (upload) resolve(upload);
            else reject(new UploadError(uploadError(request.status)));
        };
        request.onerror = () => reject(new UploadError(uploadError(0)));
        request.onabort = () => reject(new DOMException("The upload was cancelled", "AbortError"));
        options.signal?.addEventListener("abort", () => request.abort());
        request.send(zip as XMLHttpRequestBodyInit);
    });
}

export type PublishStatus =
    // Waiting for the author to finish on textadventures.co.uk
    | { status: "pending" }
    | { status: "published"; gameUrl?: string }
    // The upload has expired (after an hour), so it would need publishing again
    | { status: "gone" };

// The site's answer about an upload, or null if it isn't as expected
export function parseStatus(httpStatus: number, data: unknown): PublishStatus | null {
    if (httpStatus === 404) return { status: "gone" };
    if (httpStatus !== 200) return null;
    const answer = data as { status?: unknown; gameUrl?: unknown } | null;
    if (answer?.status === "pending") return { status: "pending" };
    if (answer?.status === "published") return { status: "published", gameUrl: isHttpUrl(answer.gameUrl) ? answer.gameUrl : undefined };
    return null;
}

// What became of an upload, or null if the site can't be asked just now
export async function checkStatus(id: string, base: string = PUBLISH_API_URL): Promise<PublishStatus | null> {
    try {
        const response = await fetch(statusUrl(base, id), { cache: "no-store" });
        return parseStatus(response.status, response.status === 200 ? await response.json() : null);
    } catch {
        return null;
    }
}

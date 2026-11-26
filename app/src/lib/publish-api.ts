// Publishing a story to textadventures.co.uk from an editor (this one, or the VS Code
// extension). An editor has no login there, so it uploads the published story with no credentials
// and is given a page on textadventures.co.uk for the author to open (the claim URL), where their
// own login finishes publishing it. The editor then asks what became of the upload, to say when
// it's published. The site's side is textadventures.co.uk's PublishApiController, and its
// docs/one-click-publish.md has the design.
// Nothing here depends on the editor: publish-online.ts has the editor's side.

export const DEFAULT_PUBLISH_API_URL = "https://textadventures.co.uk/api/publish/uploads";

// The site's limit, checked here first so a story that's too big isn't uploaded to be refused
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// Which editor is publishing, as for the home page's featured games: "web" or "electron" for this
// one, "vscode" for the extension
export interface PublishClient {
    source: "web" | "electron" | "vscode";
    version: string;
    platform?: string;
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

// Uploads the published story (the zip) with fetch, which works in Node and in a Web Worker, but
// can't say how far an upload has got (publish-online.ts's uploadStory can, in a page)
export async function postStory(zip: Uint8Array, filename: string, client: PublishClient, base: string, signal?: AbortSignal): Promise<Upload> {
    if (zip.byteLength > MAX_UPLOAD_BYTES) throw new UploadError(uploadError(413));
    let response: Response;
    try {
        response = await fetch(uploadUrl(base, filename, client), {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: zip as BodyInit,
            signal,
        });
    } catch (err) {
        if (signal?.aborted) throw err;
        throw new UploadError(uploadError(0));
    }
    if (response.status !== 201) throw new UploadError(uploadError(response.status));
    let data: unknown = null;
    try {
        data = await response.json();
    } catch {
        // Not JSON, so not an upload
    }
    const upload = parseUpload(data);
    if (!upload) throw new UploadError(uploadError(response.status));
    return upload;
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
export async function checkStatus(id: string, base: string): Promise<PublishStatus | null> {
    try {
        const response = await fetch(statusUrl(base, id), { cache: "no-store" });
        return parseStatus(response.status, response.status === 200 ? await response.json() : null);
    } catch {
        return null;
    }
}

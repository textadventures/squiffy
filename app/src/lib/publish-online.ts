// Publishing a story to textadventures.co.uk from the editor: publish-api.ts has the rest, which
// the VS Code extension uses too.
import { desktopApi } from "./desktop.js";
import { checkStatus as statusOf, DEFAULT_PUBLISH_API_URL, MAX_UPLOAD_BYTES, parseUpload, uploadError, uploadUrl, UploadError, type PublishClient, type Upload } from "./publish-api.js";

export { MAX_UPLOAD_BYTES, UploadError, type PublishClient, type PublishStatus, type Upload } from "./publish-api.js";

// VITE_PUBLISH_API_URL points a development build at a local copy of textadventures.co.uk
export const PUBLISH_API_URL: string = import.meta.env.VITE_PUBLISH_API_URL || DEFAULT_PUBLISH_API_URL;

// What became of an upload, or null if the site can't be asked just now
export const checkStatus = (id: string) => statusOf(id, PUBLISH_API_URL);

// Which editor is publishing, as for the home page's featured games
export function publishClient(): PublishClient {
    const api = desktopApi();
    return { source: api ? "electron" : "web", version: __APP_VERSION__, platform: api?.desktop.platform };
}

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


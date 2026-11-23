// A story as a link: its files, compressed into the part of a web address after the "#", which a
// browser never sends to a server. So a story can be shared without being uploaded anywhere: the
// link is the story. The player page (main.ts) plays it, and the editor opens it as a new story of
// the reader's own.
//
//     https://squiffystories.com/v7/#story=1q1YqS8wpTVWyUoIw...
//
// The path says which version of Squiffy plays the story. The first character of the payload says
// how the rest is encoded, so that can change without a new path:
//
//     1    base64url of raw deflate of: a line of JSON listing each file's path and length in
//          bytes, [["story.squiffy", 1234], ["cat.png", 567]], then the files' bytes, in that order
//
// It's one stream, rather than a zip, because a zip is longer: it has headers for each file, which
// aren't compressed, and compresses each file on its own (a third as long again for a small story).
// An image in it costs four characters for every three bytes, as it's already compressed.

import { deflateSync, Inflate, strFromU8, strToU8 } from "fflate";

export interface LinkedStory {
    // The story's text files (.squiffy, .css, .js and squiffy.json), by project path
    files: Record<string, string>;
    // Its other files, which are small images for the most part
    assets?: Record<string, Uint8Array>;
    // The main file, for a story with no squiffy.json to say. It's the first file in the link.
    main?: string;
}

// The files that are the story's text, which the compiler reads. The rest are assets.
export const isStoryText = (path: string) => /\.(squiffy|css|js)$/i.test(path) || path === "squiffy.json";

const FORMAT = "1";
const KEY = "story";

// A link can be made that inflates to far more than a story's worth, so decoding stops here
const MAX_DECODED_BYTES = 4 * 1024 * 1024;

// Links up to this long can be pasted anywhere, including chat apps that cut messages off
export const SHORT_LINK_LENGTH = 2000;
// Longer than this and a link isn't offered: browsers take far more, but little else does
export const MAX_LINK_LENGTH = 32000;

function toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
    if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("not base64url");
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function inflate(data: Uint8Array): Uint8Array {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const stream = new Inflate(chunk => {
        size += chunk.length;
        if (size > MAX_DECODED_BYTES) throw new Error("too big");
        chunks.push(chunk);
    });
    // In pieces, so one that's too big is stopped before it's all in memory
    const step = 4096;
    for (let i = 0; i < data.length; i += step) stream.push(data.subarray(i, i + step), i + step >= data.length);
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

// A project path that stays inside the story's folder
const isSafePath = (path: string) =>
    path.length > 0 && path.length < 256 && !/[\\:*?"<>|\0]/.test(path)
    && path.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..");

// The payload for a story: what follows "#story=" in its link
export function encodeStory(story: LinkedStory): string {
    const texts = Object.entries(story.files).map(([path, text]): [string, Uint8Array] => [path, strToU8(text)]);
    // The main file first, which is how a story with no squiffy.json says which it is
    texts.sort(([a], [b]) => Number(b === story.main) - Number(a === story.main));
    const entries = [...texts, ...Object.entries(story.assets ?? {})];
    const list = strToU8(JSON.stringify(entries.map(([path, data]) => [path, data.length])) + "\n");
    const data = new Uint8Array(entries.reduce((size, [, bytes]) => size + bytes.length, list.length));
    data.set(list);
    let offset = list.length;
    for (const [, bytes] of entries) {
        data.set(bytes, offset);
        offset += bytes.length;
    }
    return FORMAT + toBase64Url(deflateSync(data, { level: 9 }));
}

// The story in a payload, or null if it isn't one
export function decodeStory(payload: string): LinkedStory | null {
    if (payload[0] !== FORMAT) return null;
    try {
        const data = inflate(fromBase64Url(payload.slice(1)));
        const end = data.indexOf(10);
        if (end < 0) return null;
        const list: unknown = JSON.parse(strFromU8(data.subarray(0, end)));
        if (!Array.isArray(list) || !list.length) return null;
        const files: Record<string, string> = {};
        const assets: Record<string, Uint8Array> = {};
        let main: string | undefined;
        let offset = end + 1;
        for (const entry of list) {
            if (!Array.isArray(entry) || entry.length !== 2) return null;
            const [path, length] = entry as unknown[];
            if (typeof path !== "string" || !isSafePath(path) || path in files || path in assets) return null;
            if (typeof length !== "number" || !Number.isInteger(length) || length < 0 || offset + length > data.length) return null;
            const bytes = data.slice(offset, offset + length);
            offset += length;
            if (isStoryText(path)) {
                files[path] = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
                if (main === undefined && path.toLowerCase().endsWith(".squiffy")) main = path;
            }
            else assets[path] = bytes;
        }
        if (offset !== data.length || main === undefined) return null;
        return { files, ...(Object.keys(assets).length ? { assets } : {}), main };
    } catch {
        return null;
    }
}

// The fragment for a payload, with its "#"
export const storyFragment = (payload: string) => `#${KEY}=${payload}`;

// The payload in a page's location.hash, if it has one
export function payloadFromFragment(hash: string): string | null {
    const value = new URLSearchParams(hash.replace(/^#/, "")).get(KEY);
    return value || null;
}

// The story's main file: squiffy.json's, if it has one, else the first in the link
export function mainFile(story: LinkedStory): string | undefined {
    try {
        const main: unknown = JSON.parse(story.files["squiffy.json"] ?? "{}").main;
        if (typeof main === "string" && main in story.files) return main;
    } catch {
        // Not a squiffy.json the story can use, which the compiler will say
    }
    return story.main ?? Object.keys(story.files).find(path => path.toLowerCase().endsWith(".squiffy"));
}

// A file's path as the story refers to it, which is from the main file's folder. Null for a file
// that isn't in that folder, which the story can't use.
export function storyPath(main: string, path: string): string | null {
    const folder = main.slice(0, main.lastIndexOf("/") + 1);
    return path.startsWith(folder) ? path.slice(folder.length) : null;
}

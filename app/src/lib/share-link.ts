// Publish's "A link": the whole story in a web address, which the player at squiffystories.com
// plays (see player/src/link.ts, which has the encoding). Nothing is uploaded, so there's nothing
// to host or take down, and only a small story fits: its text files, and any small images.
// The same link opens in the editor as a new story (linkedStoryFiles), so a reader can change
// someone's story and share their own version.
import { encodeStory, isStoryText, storyFragment, MAX_LINK_LENGTH, SHORT_LINK_LENGTH, type LinkedStory } from "@textadventures/squiffy-player/link";
import { PROJECT_FILENAME, PROJECT_SCHEMA_URL } from "squiffy-compiler";
import { isAsset } from "./file-types.js";

export { MAX_LINK_LENGTH, SHORT_LINK_LENGTH };

// The player is in a folder for each major version of Squiffy, which goes on playing that
// version's stories. squiffystories.com is a domain of its own, apart from squiffystory.com, so a
// story's JavaScript is nowhere near the editor or the stories kept in it.
const PLAYER_ORIGIN: string = import.meta.env.VITE_PLAYER_URL || (import.meta.env.DEV ? "http://localhost:5181" : "https://squiffystories.com");
export const playerUrl = (version: string) => `${PLAYER_ORIGIN}/v${version.split(".")[0]}/`;

// The biggest image (or other asset) that goes in a link. One this size adds about 5,500
// characters, as it's already compressed, so a link has room for a few.
export const MAX_ASSET_BYTES = 4096;

export interface StoryLink {
    url: string;
    // The same link, asking the player not to show its "Open in editor" button. That's all it
    // does: the story's files can still be read from the link.
    noEditUrl: string;
    // The images and so on that are in the link
    assets: string[];
    // The project's files that aren't: bigger images, sounds and so on
    leftOut: string[];
}

// squiffy.json as it goes in a link: without what the next author doesn't need, or shouldn't
// have (a copy of the story is a new story, with its own ID), and without the spaces
function packProjectFile(text: string): string {
    try {
        const json: unknown = JSON.parse(text);
        if (typeof json !== "object" || json === null || Array.isArray(json)) return text;
        const rest = Object.entries(json).filter(([key]) => !["$schema", "id", "map"].includes(key));
        return JSON.stringify(Object.fromEntries(rest));
    } catch {
        return text;
    }
}

// The reverse, for a story opened from a link: a new ID, and laid out to be read
function unpackProjectFile(text: string): string {
    try {
        const json: unknown = JSON.parse(text);
        if (typeof json !== "object" || json === null || Array.isArray(json)) return text;
        const { version, ...rest } = json as Record<string, unknown>;
        return JSON.stringify({ $schema: PROJECT_SCHEMA_URL, version, id: crypto.randomUUID(), ...rest }, null, 2) + "\n";
    } catch {
        return text;
    }
}

// The link for a project's files (text files as text), or why there can't be one
export function createStoryLink(files: Map<string, string | Uint8Array>, mainFile: string, version: string): StoryLink | { error: string } {
    const linked: Record<string, string> = {};
    const assets: Record<string, Uint8Array> = {};
    const leftOut: string[] = [];
    for (const [path, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
        if (isStoryText(path) && typeof content === "string") linked[path] = path === PROJECT_FILENAME ? packProjectFile(content) : content;
        else if (isAsset(path) && typeof content !== "string" && content.length <= MAX_ASSET_BYTES) assets[path] = content;
        else leftOut.push(path);
    }
    const link = (story: LinkedStory, edit = true) => playerUrl(version) + storyFragment(encodeStory(story), { edit });
    const story: LinkedStory = { files: linked, assets, main: mainFile };
    const url = link(story);
    if (url.length > MAX_LINK_LENGTH) {
        const length = `the link would be ${url.length.toLocaleString()} characters long, and ${MAX_LINK_LENGTH.toLocaleString()} is the most that works`;
        // Whether it's the images that are too much, or the story is anyway
        const fits = Object.keys(assets).length > 0 && link({ ...story, assets: {} }).length <= MAX_LINK_LENGTH;
        return {
            error: fits
                ? `This story's images are too big to share it as a link: ${length}. Use fewer or smaller images, or publish it another way.`
                : `This story is too big to share as a link: ${length}. Publish it another way.`,
        };
    }
    // Seven characters longer, which the limit has room for
    return { url, noEditUrl: link(story, false), assets: Object.keys(assets), leftOut };
}

// The files of a new story made from a link's
export function linkedStoryFiles(story: LinkedStory): Map<string, string | Uint8Array> {
    return new Map<string, string | Uint8Array>([
        ...Object.entries(story.files).map(([path, text]): [string, string] => [path, path === PROJECT_FILENAME ? unpackProjectFile(text) : text]),
        ...Object.entries(story.assets ?? {}),
    ]);
}

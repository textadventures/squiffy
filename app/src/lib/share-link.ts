// Publish's "A link", from the editor: story-link.ts has the rest, which the VS Code extension
// uses too.
import { createStoryLink as linkFor, playerFolder, type StoryLink } from "./story-link.js";

export { linkedStoryFiles, MAX_ASSET_BYTES, MAX_LINK_LENGTH, SHORT_LINK_LENGTH, type StoryLink } from "./story-link.js";

// squiffystories.com is a domain of its own, apart from squiffystory.com, so a story's JavaScript
// is nowhere near the editor or the stories kept in it.
export const PLAYER_ORIGIN: string = import.meta.env.VITE_PLAYER_URL || (import.meta.env.DEV ? "http://localhost:5181" : "https://squiffystories.com");
export const playerUrl = (version: string) => playerFolder(PLAYER_ORIGIN, version);

// The link for a project's files (text files as text), or why there can't be one
export function createStoryLink(files: Map<string, string | Uint8Array>, mainFile: string, version: string): StoryLink | { error: string } {
    return linkFor(files, mainFile, playerUrl(version));
}

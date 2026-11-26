// A squiffy.json for a story that hasn't one (server.ts's NEW_PROJECT_FILE)

import { getStoryFiles } from "squiffy-compiler";

// What a new squiffy.json leaves out: a squiffy.json makes every .squiffy, .css and .js file in
// the folder part of the story, so the ones that aren't part of it now are listed, as the
// command-line tool's --convert-v6 lists them. `paths` are every file in the folder, and
// `inStory` the story's files now: its .squiffy files and the .css and .js files they use.
export function projectFileExcludes(main: string, paths: string[], inStory: string[]): string[] {
    const story = new Set([main, ...inStory]);
    const all = getStoryFiles({ version: 1, main, exclude: [] }, paths);
    return [...all.included, ...all.stylesheets, ...all.scripts].filter(path => !story.has(path));
}

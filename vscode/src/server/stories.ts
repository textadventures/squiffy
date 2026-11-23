// Which story each file is part of, with a language service for each story.
//
// A folder with a squiffy.json is a story, with every file under it (folder mode). A .squiffy
// file anywhere else is part of the story in its own folder, whose main file is the first file
// opened there, unless Use as Main File picks another.
//
// The language service works with project paths: relative to the story's folder, with "/"
// separators. Here they're mapped to and from the URIs VS Code uses.

import { createLanguageService, type LanguageService } from "squiffy-compiler/language-service";

export interface StoryHost {
    // The URIs of every squiffy.json in the workspace
    findProjectFiles(): Promise<string[]>;
    // Every file under a folder (a URI ending "/"), as paths from it
    listFiles(root: string): Promise<string[]>;
    readText(uri: string): Promise<string>;
}

export interface Story {
    // The story's folder, as a URI ending "/"
    root: string;
    // Whether the folder has a squiffy.json
    project: boolean;
    service: LanguageService;
}

const PROJECT_FILENAME = "squiffy.json";

// The folder a file is in, as a URI ending "/"
export const folderOf = (uri: string) => uri.substring(0, uri.lastIndexOf("/") + 1);

// Encodes a path segment as VS Code's Uri.toString() does: everything but letters, digits and
// -._~ is percent-encoded.
const encodeSegment = (segment: string) =>
    encodeURIComponent(segment).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());

// A URI's project path, if it's in the folder
export function toPath(root: string, uri: string): string | undefined {
    if (!uri.startsWith(root)) return undefined;
    const relative = uri.substring(root.length);
    if (!relative) return undefined;
    try {
        return relative.split("/").map(decodeURIComponent).join("/");
    }
    catch {
        return undefined;
    }
}

export const toUri = (root: string, path: string) => root + path.split("/").map(encodeSegment).join("/");

export class Stories {
    // The folders with a squiffy.json, deepest first, once they've been found
    private projectRoots: Promise<string[]> | undefined;
    private stories = new Map<string, Story>();
    // The text of the files open in editors, which takes precedence over what's saved
    private openFiles = new Map<string, string>();

    constructor(private host: StoryHost) {}

    private getProjectRoots() {
        this.projectRoots ??= this.host.findProjectFiles().then(uris =>
            uris.filter(uri => uri.endsWith("/" + PROJECT_FILENAME)).map(folderOf).sort((a, b) => b.length - a.length));
        return this.projectRoots;
    }

    // The story a file is part of
    async storyFor(uri: string): Promise<Story> {
        const roots = await this.getProjectRoots();
        const projectRoot = roots.find(root => uri.startsWith(root));
        const root = projectRoot ?? folderOf(uri);
        let story = this.stories.get(root);
        if (!story) {
            story = this.createStory(root, !!projectRoot, toPath(root, uri)!);
            this.stories.set(root, story);
        }
        return story;
    }

    private createStory(root: string, project: boolean, mainFile: string): Story {
        const service = createLanguageService({
            // A squiffy.json's main file takes precedence
            mainFile,
            files: {
                list: async () => (await this.host.listFiles(root)).map(path => ({ path })),
                readText: path => this.host.readText(toUri(root, path)),
            },
        });
        for (const [uri, text] of this.openFiles) {
            const path = toPath(root, uri);
            if (path !== undefined) service.updateFile(path, text);
        }
        return { root, project, service };
    }

    // A file's text in an editor, or undefined when it's closed. Returns the story it's part of.
    async setOpenText(uri: string, text: string | undefined): Promise<Story> {
        if (text === undefined) this.openFiles.delete(uri);
        else this.openFiles.set(uri, text);
        const story = await this.storyFor(uri);
        story.service.updateFile(toPath(story.root, uri)!, text);
        return story;
    }

    // A file was changed, added or deleted. Returns the stories it could affect, or "reset" when
    // a squiffy.json was added or deleted, which changes which story every file is part of, so
    // the stories start again.
    async fileChanged(uri: string): Promise<Story[] | "reset"> {
        if (uri.endsWith("/" + PROJECT_FILENAME)) {
            const known = await this.getProjectRoots();
            this.projectRoots = undefined;
            const roots = await this.getProjectRoots();
            if (roots.length != known.length || roots.some((root, i) => root != known[i])) {
                this.stories.clear();
                return "reset";
            }
        }
        const affected: Story[] = [];
        for (const story of this.stories.values()) {
            const path = toPath(story.root, uri);
            if (path === undefined) continue;
            story.service.fileChanged(path);
            affected.push(story);
        }
        return affected;
    }

    // Makes a file the main file of the story in its folder, if the folder has no squiffy.json
    async setMainFile(uri: string): Promise<Story | undefined> {
        const story = await this.storyFor(uri);
        if (story.project) return undefined;
        story.service.setMainFile(toPath(story.root, uri)!);
        return story;
    }
}

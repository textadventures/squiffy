import path from "path";
import fs from "fs/promises";
import { glob } from "glob";
import { compile } from "squiffy-compiler";
import { findStory, StoryNotFoundError } from "squiffy-compiler/node";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";

export interface SquiffyPluginOptions {
    /** Log each .squiffy file as it is compiled (defaults to false). */
    verbose?: boolean;
}

const toImportPath = (from: string, to: string) => {
    const relative = path.relative(path.dirname(from), to).split(path.sep).join("/");
    return relative.startsWith(".") ? relative : "./" + relative;
};

// Like the CLI's external-files.ts, but also records every file that was read,
// so that Vite can watch them and rebuild when an imported file changes.
const externalFiles = (inputFilename: string, readFiles: string[]) => {
    const basePath = path.dirname(inputFilename);
    return {
        getMatchingFilenames: async (pattern: string): Promise<string[]> => {
            const result = await glob(path.join(basePath, pattern).split(path.sep).join("/"), { absolute: true });
            // Sort the matches, as the editor and CLI do, since glob's order isn't
            // guaranteed and decides which same-named section wins.
            const relative = (filename: string) => path.relative(basePath, filename).split(path.sep).join("/");
            return result
                .filter(filename => !readFiles.includes(filename))
                .map(filename => ({ filename, key: relative(filename) }))
                .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
                .map(f => f.filename);
        },
        getContent: async (filename: string): Promise<string> => {
            const resolvedPath = path.resolve(basePath, filename);
            readFiles.push(resolvedPath);
            return (await fs.readFile(resolvedPath)).toString();
        },
        getLocalFilename: (filename: string): string => filename,
    };
};

export default function squiffyPlugin(options: SquiffyPluginOptions = {}): Plugin {
    const { verbose = false } = options;
    // Each loaded project's main file (the module id), by the folder its squiffy.json is in. A
    // .squiffy, .css or .js file added to or removed from that folder changes the story, but Vite
    // only watches files the story has already read, so the dev server is told to rebuild it.
    const projectFolders = new Map<string, string>();
    let server: ViteDevServer | undefined;
    // squiffy.json makes every .css and .js file in its folder part of the story, so if it's in
    // the app's own folder, Vite's output, its public folder and its config are left out
    let skip: string[] = [];

    const onFileAddedOrRemoved = (file: string) => {
        if (!server || !/\.(squiffy|css|js)$/.test(file)) return;
        for (const [id, folder] of projectFolders) {
            if (!path.relative(folder, file).startsWith("..")) {
                const module = server.moduleGraph.getModuleById(id);
                if (module) void server.reloadModule(module);
            }
        }
    };

    return {
        name: "vite-plugin-squiffy",
        enforce: "pre",

        configResolved(config: ResolvedConfig) {
            skip = [
                path.resolve(config.root, config.build.outDir),
                ...(config.publicDir ? [config.publicDir] : []),
                ...(config.configFile ? [config.configFile] : []),
            ];
        },

        configureServer(devServer) {
            server = devServer;
            devServer.watcher.on("add", onFileAddedOrRemoved);
            devServer.watcher.on("unlink", onFileAddedOrRemoved);
        },

        async load(id) {
            const filename = id.split("?")[0];
            if (!filename.endsWith(".squiffy")) return null;

            if (verbose) {
                this.info(`compiling ${filename}`);
            }

            // The same rule as the CLI: importing a project's main file builds the whole project in
            // its squiffy.json, and importing any other file builds just that file.
            let story;
            try {
                story = await findStory(filename, { skip });
            }
            catch (e) {
                if (e instanceof StoryNotFoundError) this.error(e.message);
                throw e;
            }
            if (story.note && verbose) {
                this.info(story.note);
            }

            const readFiles = [filename];
            const result = await compile({
                scriptBaseFilename: path.basename(filename),
                script: (await fs.readFile(filename)).toString(),
                onWarning: message => this.warn(message),
                externalFiles: externalFiles(filename, readFiles),
                storyFiles: story.storyFiles,
                expressions: story.expressions,
                projectId: story.projectId,
                panels: story.panels,
                settings: story.settings,
            });

            for (const file of readFiles.slice(1)) {
                this.addWatchFile(file);
            }
            if (story.projectFile) {
                this.addWatchFile(story.projectFile);
                projectFolders.set(id, path.dirname(story.projectFile));
            }
            else {
                projectFolders.delete(id);
            }

            if (!result.success) {
                this.error(`Failed to compile ${filename}:\n${result.errors.join("\n")}`);
            }

            // Scripts and stylesheets pulled in with @import are bundled by Vite
            // instead of being added as <script> and <link> tags.
            const uiInfo = result.getUiInfo();
            const imports = [...uiInfo.externalStylesheets, ...uiInfo.externalScripts]
                .map(file => `import ${JSON.stringify(toImportPath(filename, file))};`);

            return [
                ...imports,
                await result.getJs(true),
                `export const title = ${JSON.stringify(uiInfo.title)};`,
                "export default story;",
            ].join("\n");
        },
    };
}

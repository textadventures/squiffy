import path from "path";
import fs from "fs/promises";
import { glob } from "glob";
import { compile } from "squiffy-compiler";
import type { Plugin } from "vite";

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
            return result.filter(filename => !readFiles.includes(filename));
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

    return {
        name: "vite-plugin-squiffy",
        enforce: "pre",

        async load(id) {
            const filename = id.split("?")[0];
            if (!filename.endsWith(".squiffy")) return null;

            if (verbose) {
                this.info(`compiling ${filename}`);
            }

            const readFiles = [filename];
            const result = await compile({
                scriptBaseFilename: path.basename(filename),
                script: (await fs.readFile(filename)).toString(),
                onWarning: message => this.warn(message),
                externalFiles: externalFiles(filename, readFiles),
            });

            for (const file of readFiles.slice(1)) {
                this.addWatchFile(file);
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

// Central location for importing example Squiffy scripts
// Uses Vite's ?raw suffix to import file contents as strings

export { default as coffeeshop } from "../../examples/coffeeshop/coffeeshop.squiffy?raw";

export interface ExampleFile {
    path: string;
    code: string;
    lang: string;
}

// The game show's source files, to show on the Examples page: the main file, then its project
// file, its rounds and its stylesheet. Named one by one, as a folder that's been built locally
// may have an old build's files in it too (style.css, ...).
const gameshowFiles = import.meta.glob<string>(
    ["../../examples/gameshow/gameshow.squiffy", "../../examples/gameshow/squiffy.json", "../../examples/gameshow/rounds/*.squiffy", "../../examples/gameshow/studio.css"],
    { query: "?raw", import: "default", eager: true },
);

const langs: Record<string, string> = { squiffy: "squiffy", json: "json", css: "css" };

export const gameshow: ExampleFile[] = Object.entries(gameshowFiles)
    .map(([file, code]) => {
        const path = file.replace("../../examples/gameshow/", "");
        return { path, code, lang: langs[path.split(".").pop()!] };
    })
    .sort((a, b) => order(a.path) - order(b.path) || a.path.localeCompare(b.path));

function order(path: string): number {
    if (path == "gameshow.squiffy") return 0;
    if (path == "squiffy.json") return 1;
    if (path.endsWith(".squiffy")) return 2;
    return 3;
}

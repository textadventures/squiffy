// Central location for importing example Squiffy scripts
// Uses Vite's ?raw suffix to import file contents as strings

import { encodeStory, storyFragment } from "@textadventures/squiffy-player/link";
import { stableAppUrl } from "./channel.mjs";
import coffeeshop from "../../examples/coffeeshop/coffeeshop.squiffy?raw";
import coffeeshopCss from "../../examples/coffeeshop/daily-grind.css?raw";
import coffeeshopProject from "../../examples/coffeeshop/squiffy.json?raw";

export { coffeeshop };

// The coffee shop's story as a link that opens it in the editor, as a new story: all of it but
// its playthrough tests, which are in the download. It's to the stable editor: a beta build's
// links are rewritten to the beta one (app-links.mjs). The game show has no such link, as its
// sounds would make it far too long.
export const coffeeshopEditorLink = `${stableAppUrl}/${storyFragment(encodeStory({
    files: {
        "coffeeshop.squiffy": coffeeshop,
        "daily-grind.css": coffeeshopCss,
        "squiffy.json": coffeeshopProject,
    },
}))}`;

export interface ExampleFile {
    path: string;
    code: string;
    lang: string;
}

// The game show's source files, to show on the Examples page: the main file, then its project
// file, its rounds, its stylesheet and its script. Named one by one, as a folder that's been built locally
// may have an old build's files in it too (squiffy.css, ...).
const gameshowFiles = import.meta.glob<string>(
    ["../../examples/gameshow/gameshow.squiffy", "../../examples/gameshow/squiffy.json", "../../examples/gameshow/rounds/*.squiffy", "../../examples/gameshow/studio.css", "../../examples/gameshow/confetti.js"],
    { query: "?raw", import: "default", eager: true },
);

const langs: Record<string, string> = { squiffy: "squiffy", json: "json", css: "css", js: "js" };

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

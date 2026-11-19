// What a file made with the New file button starts with
import { basename, extname } from "@textadventures/project-fs";
import { DOCS_URL } from "./links.js";

// The kinds of file in the New file menu, with the name each suggests
export const NEW_FILE_KINDS = {
    squiffy: { label: "Story file (.squiffy)", noun: "story file", name: "chapter.squiffy" },
    css: { label: "Stylesheet (.css)", noun: "stylesheet", name: "style.css" },
    js: { label: "Script (.js)", noun: "script", name: "script.js" },
} as const;

export type NewFileKind = keyof typeof NEW_FILE_KINDS;

// A stylesheet or script is only part of the story once the main file @imports it, even with a
// squiffy.json, so the editor adds the @import when it makes one
export function needsImport(path: string): boolean {
    const ext = extname(path).toLowerCase();
    return ext === ".css" || ext === ".js";
}

// A stylesheet starts with the most common changes, commented out, and their defaults, so the
// author can see what they can change without finding Squiffy's own CSS (#198)
// (short lines, so they don't wrap in a narrow editor)
const cssText = `/* Your story's styles. These take precedence over Squiffy's own.

   Below are some common changes, with Squiffy's defaults.
   To use one, remove the comment marks around it.
   light-dark() gives a colour for light mode and one for dark mode.

   For more, see ${DOCS_URL}/styling/ */

/*
:root {
    --squiffy-background: light-dark(#ffffff, #18181b);
    --squiffy-text: light-dark(#1f2328, #e4e4e7);
    --squiffy-link: light-dark(#1d5fd6, #7aa7ff);
    --squiffy-link-hover: light-dark(#0f3f99, #b0cbff);
    --squiffy-border: light-dark(#e2e2e6, #34343a);

    --squiffy-font-family: Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif;
    --squiffy-font-size: 1.125rem;
    --squiffy-line-height: 1.6;
    --squiffy-max-width: 42rem;
}
*/

/* To keep the story in light mode whatever the reader's setting
   (or dark, with "dark"). This also hides the light/dark button.
:root {
    color-scheme: light;
}
*/
`;

export function newFileText(path: string): string {
    const ext = extname(path).toLowerCase();
    if (ext === ".squiffy") return `[[${basename(path).replace(/\.squiffy$/i, "")}]]:\n\n`;
    if (ext === ".css") return cssText;
    return "";
}

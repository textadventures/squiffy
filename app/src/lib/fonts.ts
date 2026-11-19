// Web fonts for a story. A font is downloaded from Fontsource (Google Fonts and other open
// source fonts) into the story's own folder, as fonts/<id>/: its files, its licence, and a
// stylesheet with its @font-face rules. From then on it's an ordinary part of the story, so the
// preview, publishing and the CLI all work offline, and the published story never asks Google
// for anything. Only adding a font needs the internet.
//
// The story's font is the one whose stylesheet sets --squiffy-font-family, in a rule this file
// adds and removes (STORY_FONT_RULE). A font without it can still be used by the story's own CSS.

import { dirname, extname, joinPath } from "@textadventures/project-fs";
import type { OpenProject } from "./project.svelte.js";

export const FONTS_FOLDER = "fonts";

const API = "https://api.fontsource.org/v1/fonts";
const LICENCE_URL = (id: string, version: string) => `https://cdn.jsdelivr.net/npm/@fontsource/${id}@${version}/LICENSE`;

export type FontCategory = "serif" | "sans-serif" | "display" | "handwriting" | "monospace" | string;

// A font in Fontsource's list
export interface FontSummary {
    id: string;
    family: string;
    category: FontCategory;
    subsets: string[];
    weights: number[];
    styles: string[];
    license?: string;
}

// A font's files: variants[weight][style][subset].url.woff2. The subsets of a font with a lot of
// characters, such as a Japanese one, are numbered ("0", "1", ...), with unicodeRange keys "[0]" etc.
export interface FontDetails extends FontSummary {
    npmVersion?: string;
    unicodeRange: Record<string, string>;
    variants: Record<string, Record<string, Record<string, { url: Record<string, string> }>>>;
}

// Good fonts for reading a story in, offered before the whole list is searched
export const RECOMMENDED_FONTS: { id: string; family: string; category: FontCategory }[] = [
    { id: "literata", family: "Literata", category: "serif" },
    { id: "source-serif-4", family: "Source Serif 4", category: "serif" },
    { id: "lora", family: "Lora", category: "serif" },
    { id: "eb-garamond", family: "EB Garamond", category: "serif" },
    { id: "crimson-pro", family: "Crimson Pro", category: "serif" },
    { id: "libre-baskerville", family: "Libre Baskerville", category: "serif" },
    { id: "alegreya", family: "Alegreya", category: "serif" },
    { id: "newsreader", family: "Newsreader", category: "serif" },
    { id: "im-fell-english", family: "IM Fell English", category: "serif" },
    { id: "atkinson-hyperlegible", family: "Atkinson Hyperlegible", category: "sans-serif" },
    { id: "source-sans-3", family: "Source Sans 3", category: "sans-serif" },
    { id: "nunito", family: "Nunito", category: "sans-serif" },
    { id: "lexend", family: "Lexend", category: "sans-serif" },
    { id: "courier-prime", family: "Courier Prime", category: "monospace" },
    { id: "special-elite", family: "Special Elite", category: "display" },
    { id: "vt323", family: "VT323", category: "monospace" },
];

// The subsets a new font has to start with, if it has them: enough for English and most
// European languages
export const DEFAULT_SUBSETS = ["latin", "latin-ext"];

// The fonts to fall back on, for characters the font doesn't have, or while it loads
export function fallbackFor(category: FontCategory): string {
    switch (category) {
        case "sans-serif": return "system-ui, sans-serif";
        case "monospace": return "\"Courier New\", monospace";
        default: return "Georgia, serif";
    }
}

// A subset's name to show, e.g. "latin-ext" -> "Latin Extended"
export function subsetLabel(subset: string): string {
    return subset.split("-").map(word => word == "ext" ? "Extended" : word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

let catalogue: Promise<FontSummary[]> | undefined;

// Fontsource's whole list, fetched once. Fails offline.
export function fetchCatalogue(): Promise<FontSummary[]> {
    catalogue ??= fetchJson<FontSummary[]>(API).catch(error => {
        catalogue = undefined;
        throw error;
    });
    return catalogue;
}

export const fetchFontDetails = (id: string) => fetchJson<FontDetails>(`${API}/${encodeURIComponent(id)}`);

async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return await response.json() as T;
}

// The URL of a font's normal, regular weight Latin file, to show its name in the font
export function previewUrl(id: string): string {
    return `https://cdn.jsdelivr.net/fontsource/fonts/${encodeURIComponent(id)}@latest/latin-400-normal.woff2`;
}

export interface FontFace {
    weight: number;
    style: "normal" | "italic";
    // The subset's key in the font's variants, and its unicode-range, if it has one
    subset: string;
    unicodeRange?: string;
    url: string;
    // The file's name in the font's folder
    file: string;
}

// The weights a story needs: the regular one (400, or the closest there is) for its text, and a
// bold one (700, or the heaviest heavier one) for <b> and headings, if the font has one
export function chooseWeights(weights: number[]): number[] {
    if (!weights.length) return [];
    const regular = [...weights].sort((a, b) => Math.abs(a - 400) - Math.abs(b - 400) || a - b)[0];
    const heavier = weights.filter(w => w >= regular + 200);
    const bold = heavier.includes(700) ? 700 : heavier.length ? Math.max(...heavier) : undefined;
    return bold === undefined ? [regular] : [regular, bold];
}

// The files to download for a font: its regular and bold weights, normal and italic, in the
// chosen subsets. A subset that isn't among the font's files by name (such as "japanese") is the
// font's numbered subsets.
export function chooseFaces(font: FontDetails, subsets: string[]): FontFace[] {
    const faces: FontFace[] = [];
    for (const weight of chooseWeights(font.weights)) {
        for (const style of ["normal", "italic"] as const) {
            const files = font.variants[String(weight)]?.[style];
            if (!files) continue;
            const keys = Object.keys(files);
            const numbered = keys.filter(key => /^\d+$/.test(key));
            const wanted = new Set(subsets.flatMap(subset => keys.includes(subset) ? [subset] : numbered));
            for (const subset of keys.filter(key => wanted.has(key))) {
                const url = files[subset].url.woff2 ?? files[subset].url.woff;
                if (!url) continue;
                const extension = url.endsWith(".woff") ? "woff" : "woff2";
                faces.push({
                    weight, style, subset, url,
                    unicodeRange: font.unicodeRange[subset] ?? font.unicodeRange[`[${subset}]`],
                    file: `${subset}-${weight}-${style}.${extension}`,
                });
            }
        }
    }
    return faces;
}

const cssString = (text: string) => `"${text.replace(/["\\]/g, "\\$&")}"`;

// The comment and rule that make a font the story's font
const STORY_FONT_COMMENT = "/* The story's font. To use this font only where your own CSS says, delete this rule. */";
const STORY_FONT_RULE = /\n*\/\* The story's font\.[^]*?\*\/\s*:root\s*\{[^}]*\}\n?/;

function storyFontRule(family: string, fallback: string): string {
    return `${STORY_FONT_COMMENT}\n:root {\n    --squiffy-font-family: ${cssString(family)}, ${fallback};\n}\n`;
}

// A font's stylesheet: a note of where it came from, the story font rule if it's the story's
// font, and an @font-face rule for each file
export function fontCss(font: FontSummary, faces: FontFace[], options: { storyFont: boolean; licence: boolean }): string {
    const lines = [
        `/* ${font.family}, ${/^[aeiou]/.test(font.category) ? "an" : "a"} ${font.category} font from Fontsource: https://fontsource.org/fonts/${font.id}`,
        options.licence
            ? `   Its licence${font.license ? ` (${font.license})` : ""} is in LICENSE.txt, which has to stay with the font. */`
            : `   Its licence${font.license ? ` is ${font.license}` : " is on that page"}. */`,
        "",
    ];
    if (options.storyFont) lines.push(storyFontRule(font.family, fallbackFor(font.category)));
    for (const face of faces) {
        lines.push(
            "@font-face {",
            `    font-family: ${cssString(font.family)};`,
            `    font-style: ${face.style};`,
            `    font-weight: ${face.weight};`,
            "    font-display: swap;",
            `    src: url(${cssString(face.file)}) format(${cssString(face.file.endsWith(".woff") ? "woff" : "woff2")});`,
            ...(face.unicodeRange ? [`    unicode-range: ${face.unicodeRange};`] : []),
            "}",
            "",
        );
    }
    return lines.join("\n");
}

// A font that's in the story: a stylesheet in the fonts folder with @font-face rules
export interface StoryFont {
    // Its stylesheet, and the folder its files are in
    css: string;
    folder: string;
    family: string;
    // Whether it's the story's font
    storyFont: boolean;
}

// The family a font stylesheet's @font-face rules are for, if it has any
export function fontFamilyIn(css: string): string | undefined {
    const match = /@font-face\s*\{[^}]*?font-family\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^;}]+))/i.exec(css);
    if (!match) return undefined;
    return (match[1] ?? match[2] ?? match[3]).replace(/\\(.)/g, "$1").trim();
}

export const isStoryFont = (css: string) => STORY_FONT_RULE.test(css);

// Makes a font's stylesheet set (or no longer set) the story's font
export function setStoryFontIn(css: string, font: { family: string; fallback?: string } | null): string {
    const without = css.replace(STORY_FONT_RULE, "\n\n").replace(/\n{3,}/g, "\n\n");
    if (!font) return without;
    const rule = storyFontRule(font.family, font.fallback ?? "Georgia, serif");
    // After the comment at the top, if there is one
    const header = /^\s*\/\*[^]*?\*\/\n*/.exec(without)?.[0] ?? "";
    return `${header.trimEnd()}${header ? "\n\n" : ""}${rule}\n${without.slice(header.length).trimStart()}`;
}

// The kind of font a stylesheet this file made is for, from its first line, so it can fall back
// on a font of the same kind
export function categoryIn(css: string): FontCategory | undefined {
    return /^\/\* .+?, an? ([\w-]+) font from Fontsource/.exec(css)?.[1];
}

// The fonts in a story, from the stylesheets in its fonts folder (beside the main file)
export async function storyFonts(project: OpenProject): Promise<StoryFont[]> {
    const folder = joinPath(dirname(project.mainFile), FONTS_FOLDER);
    const sheets = project.files.map(f => f.path)
        .filter(path => path.startsWith(`${folder}/`) && extname(path).toLowerCase() === ".css")
        .sort();
    const fonts = await Promise.all(sheets.map(async (css): Promise<StoryFont | null> => {
        const text = project.fileAt(css)?.text ?? await project.fs.readText(css).catch(() => "");
        const family = fontFamilyIn(text);
        return family ? { css, folder: dirname(css), family, storyFont: isStoryFont(text) } : null;
    }));
    return fonts.filter(f => f !== null);
}

async function readCss(project: OpenProject, path: string): Promise<string> {
    return project.fileAt(path)?.text ?? await project.fs.readText(path);
}

// Makes a font in the story the story's font, or none of them, for Squiffy's own
export async function setStoryFont(project: OpenProject, font: StoryFont | null) {
    for (const other of await storyFonts(project)) {
        if (other.css === font?.css || !other.storyFont) continue;
        await project.writeText(other.css, setStoryFontIn(await readCss(project, other.css), null));
    }
    if (font && !font.storyFont) {
        const css = await readCss(project, font.css);
        await project.writeText(font.css, setStoryFontIn(css, { family: font.family, fallback: fallbackFor(categoryIn(css) ?? "serif") }));
    }
}

// Downloads a font into the story, as fonts/<id>/. Returns its stylesheet's path.
export async function addFont(project: OpenProject, font: FontDetails, subsets: string[], options: {
    storyFont: boolean;
    onprogress?: (done: number, total: number) => void;
}): Promise<string> {
    const faces = chooseFaces(font, subsets);
    if (!faces.length) throw new Error(`${font.family} has no files to download.`);
    let done = 0;
    const download = async (url: string) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Couldn't download ${font.family}: ${url} answered ${response.status}.`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        options.onprogress?.(++done, faces.length);
        return bytes;
    };
    const [files, licence] = await Promise.all([
        Promise.all(faces.map(face => download(face.url))),
        font.npmVersion
            ? fetch(LICENCE_URL(font.id, font.npmVersion)).then(r => r.ok ? r.text() : undefined).catch(() => undefined)
            : Promise.resolve(undefined),
    ]);

    // Everything's downloaded, so nothing changes in the story unless the whole font can be added
    if (options.storyFont) await setStoryFont(project, null);
    const folder = joinPath(dirname(project.mainFile), FONTS_FOLDER, font.id);
    for (const [i, face] of faces.entries()) await project.writeFile(joinPath(folder, face.file), files[i]);
    if (licence) await project.writeFile(joinPath(folder, "LICENSE.txt"), new TextEncoder().encode(licence));
    const css = joinPath(folder, `${font.id}.css`);
    await project.writeText(css, fontCss(font, faces, { storyFont: options.storyFont, licence: !!licence }));
    return css;
}

// Deletes a font's folder from the story
export async function removeFont(project: OpenProject, font: StoryFont) {
    for (const { path } of project.files.filter(f => f.path.startsWith(`${font.folder}/`))) {
        await project.deleteFile(path);
    }
}

import { readFileSync } from "fs";
import { expect, test } from "vitest";
import { BUILT_IN_HELPERS } from "./helpers.js";
import { HELPER_INFO } from "./helper-info.js";

test("every built-in helper is described, for completion", () => {
    expect([...BUILT_IN_HELPERS].filter(name => !HELPER_INFO[name])).toEqual([]);
    expect(Object.keys(HELPER_INFO).filter(name => !BUILT_IN_HELPERS.has(name))).toEqual([]);
    // and has docs, unless it isn't suggested
    expect(Object.entries(HELPER_INFO).filter(([, info]) => !info.docs && !info.hidden).map(([name]) => name)).toEqual([]);
});

// A heading's anchor, as Starlight makes it
const slug = (heading: string) => heading.trim().toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s/g, "-");

test("each helper's docs link goes to a heading that's there", () => {
    const missing: string[] = [];
    for (const [name, info] of Object.entries(HELPER_INFO)) {
        if (!info.docs) continue;
        const [, page, anchor] = /^\/([\w-]+)\/#([\w-]+)$/.exec(info.docs)!;
        const text = readFileSync(new URL(`../../site/src/content/docs/${page}.mdx`, import.meta.url), "utf8");
        const anchors = [...text.matchAll(/^#{2,4} (.+)$/gm)].map(m => slug(m[1]));
        if (!anchors.includes(anchor)) missing.push(`${name}: ${info.docs}`);
    }
    expect(missing).toEqual([]);
});

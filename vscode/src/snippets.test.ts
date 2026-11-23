// The extension's snippets are the editor's (app/src/lib/snippets.ts), with tab stops
import { readFileSync } from "fs";
import { expect, test } from "vitest";

// The editor's snippets, read from its source: importing it would need the app's tsconfig
const source = readFileSync(new URL("../../app/src/lib/snippets.ts", import.meta.url), "utf8");
const builtInSnippets: { name: string; content: string }[] =
    new Function(`return ${/builtInSnippets: Snippet\[\] = (\[[\s\S]*?\]);/.exec(source)![1]}`)();

const snippets: Record<string, { body: string[] }> = JSON.parse(readFileSync(new URL("../snippets/squiffy.code-snippets", import.meta.url), "utf8"));

// A snippet's text, without its tab stops
const plain = (body: string[]) => body.join("\n").replace(/\$\{\d+:([^}]*)\}/g, "$1").replace(/\$\d+/g, "");

test("has the editor's snippets", () => {
    expect(Object.keys(snippets)).toEqual(builtInSnippets.map(s => s.name));
    for (const snippet of builtInSnippets) {
        expect(plain(snippets[snippet.name].body), snippet.name).toBe(snippet.content);
    }
});

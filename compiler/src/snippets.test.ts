import { expect, test } from "vitest";
import { BUILT_IN_SNIPPETS, snippetText } from "./snippets.js";

test("the Add menu's text, without tab stops", () => {
    const text = Object.fromEntries(BUILT_IN_SNIPPETS.map(s => [s.prefix, snippetText(s.body)]));
    expect(text.set).toBe("@set attribute");
    expect(text.ifelse).toBe("{{#if condition}}\n\n{{else}}\n\n{{/if}}");
    expect(text.ifvar).toBe('{{#if attribute = "value"}}\n\n{{/if}}');
    expect(text.section).toBe('{{section "name" text="label"}}');
});

test("prefixes are distinct words", () => {
    const prefixes = BUILT_IN_SNIPPETS.map(s => s.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const prefix of prefixes) expect(prefix).toMatch(/^\w+$/);
});

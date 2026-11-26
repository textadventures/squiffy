// The Add menu's snippets, named by what they're for (#710), which VS Code's snippets match
// (vscode/snippets/squiffy.code-snippets). One that starts with @ goes on a line of its own.
export interface Snippet {
    name: string;
    content: string;
}

export const builtInSnippets: Snippet[] = [
    { name: "Remember something (@set)",  content: "@set attribute" },
    { name: "Show text only if…",         content: "{{#if condition}}\n\n{{/if}}" },
    { name: "If… otherwise…",             content: "{{#if condition}}\n\n{{else}}\n\n{{/if}}" },
    { name: "If an attribute has a value", content: '{{#if attribute = "value"}}\n\n{{/if}}' },
    { name: "If a section has been seen", content: '{{#if (seen "section")}}\n\n{{/if}}' },
    { name: "Count up by 1 (@inc)",       content: "@inc attribute" },
    { name: "Count down by 1 (@dec)",     content: "@dec attribute" },
    { name: "Section link",               content: '{{section "name" text="label"}}' },
    { name: "Passage link",               content: '{{passage "name" text="label"}}' },
    { name: "Embed",                      content: '{{embed "name"}}' },
];

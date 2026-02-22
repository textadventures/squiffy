export interface Snippet {
    name: string;
    content: string;
}

export const builtInSnippets: Snippet[] = [
    { name: "If block",            content: "{{#if condition}}\n\n{{/if}}" },
    { name: "If/else block",       content: "{{#if condition}}\n\n{{else}}\n\n{{/if}}" },
    { name: "If (check variable)", content: '{{#if (eq (get "variable") "value")}}\n\n{{/if}}' },
    { name: "If (seen section)",   content: '{{#if (seen "section")}}\n\n{{/if}}' },
    { name: "Set variable",        content: '{{set "variable" "value"}}' },
    { name: "Increment",           content: '{{inc "variable"}}' },
    { name: "Decrement",           content: '{{dec "variable"}}' },
    { name: "Section link",        content: '{{section "name" text="label"}}' },
    { name: "Passage link",        content: '{{passage "name" text="label"}}' },
    { name: "Embed",               content: '{{embed "name"}}' },
];

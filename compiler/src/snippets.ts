// The built-in snippets: the editor's Add menu (app/src/lib/snippets.ts, #710) and, by their
// prefixes, the language service's completion at the start of a line, in the editor and VS Code.
// Bodies use tab stops as LSP snippets do: ${1:placeholder}, and $0 for where the cursor ends up.
export interface BuiltInSnippet {
    name: string;
    prefix: string;
    body: string;
    description: string;
}

export const BUILT_IN_SNIPPETS: readonly BuiltInSnippet[] = [
    { name: "Remember something (@set)", prefix: "set", body: "@set ${1:attribute}", description: "Sets an attribute, so the story remembers something" },
    { name: "Show text only if…", prefix: "if", body: "{{#if ${1:condition}}}\n$0\n{{/if}}", description: "Shows text if a condition is true" },
    { name: "If… otherwise…", prefix: "ifelse", body: "{{#if ${1:condition}}}\n$2\n{{else}}\n$0\n{{/if}}", description: "Shows one text or another" },
    { name: "If an attribute has a value", prefix: "ifvar", body: "{{#if ${1:attribute} = \"${2:value}\"}}\n$0\n{{/if}}", description: "Shows text if an attribute has a value" },
    { name: "If a section has been seen", prefix: "ifseen", body: "{{#if (seen \"${1:section}\")}}\n$0\n{{/if}}", description: "Shows text if the player has seen a section" },
    { name: "Count up by 1 (@inc)", prefix: "inc", body: "@inc ${1:attribute}", description: "Adds 1 to an attribute" },
    { name: "Count down by 1 (@dec)", prefix: "dec", body: "@dec ${1:attribute}", description: "Subtracts 1 from an attribute" },
    { name: "Section link", prefix: "section", body: "{{section \"${1:name}\" text=\"${2:label}\"}}", description: "A link to a section" },
    { name: "Passage link", prefix: "passage", body: "{{passage \"${1:name}\" text=\"${2:label}\"}}", description: "A link to a passage" },
    { name: "Embed", prefix: "embed", body: "{{embed \"${1:name}\"}}", description: "Embeds a section or passage's text" },
];

// A snippet's text without its tab stops, as the Add menu inserts it
export function snippetText(body: string): string {
    return body.replace(/\$\{\d+:([^}]*)\}/g, "$1").replace(/\$\{?\d+\}?/g, "");
}

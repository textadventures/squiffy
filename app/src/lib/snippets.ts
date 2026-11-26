// The Add menu's snippets, named by what they're for (#710). They're the compiler's built-in
// snippets (compiler/src/snippets.ts), which the language service also offers as completions,
// with their tab stops, by their prefixes. One that starts with @ goes on a line of its own.
import { BUILT_IN_SNIPPETS, snippetText } from "squiffy-compiler/snippets";

export interface Snippet {
    name: string;
    content: string;
}

export const builtInSnippets: Snippet[] = BUILT_IN_SNIPPETS.map(s => ({ name: s.name, content: snippetText(s.body) }));

// What the docs' editable samples (Sample.astro) share, whether they run a single script in the
// page or a story with files in the sandboxed preview (sample-project.ts): the code editor's
// look, and the copy button.
import { EditorView } from "codemirror";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// The same highlighting as the editor (app/src/lib/codemirror-theme.ts), in Starlight's colors,
// whose -high shades are the readable ones in both light and dark mode
const highlightStyle = HighlightStyle.define([
    { tag: t.keyword, color: "var(--sl-color-accent-high)", fontWeight: "bold" },
    { tag: t.comment, color: "var(--sl-color-gray-3)", fontStyle: "italic" },
    { tag: t.tagName, color: "var(--sl-color-accent-high)" },
    { tag: t.heading, color: "var(--sl-color-accent-high)", fontWeight: "bold" },
    { tag: t.heading2, color: "var(--sl-color-purple-high)", fontWeight: "bold" },
    { tag: t.link, color: "var(--sl-color-accent-high)", textDecoration: "underline" },
    { tag: t.processingInstruction, color: "var(--sl-color-orange-high)" },
    { tag: t.monospace, color: "var(--sl-color-gray-3)" },
    // For the CSS, JavaScript and JSON in a sample with files
    { tag: [t.propertyName, t.attributeName], color: "var(--sl-color-blue-high)" },
    { tag: [t.string, t.special(t.string)], color: "var(--sl-color-green-high)" },
    { tag: [t.number, t.bool, t.null, t.atom, t.color, t.unit], color: "var(--sl-color-orange-high)" },
    { tag: [t.className, t.definition(t.variableName), t.function(t.variableName)], color: "var(--sl-color-purple-high)" },
]);

// The extensions every sample's editor has, after basicSetup and its language
export const sampleEditorExtensions = [
    syntaxHighlighting(highlightStyle),
    EditorView.lineWrapping,
    EditorView.theme({
        ".cm-content": { fontSize: "13px" },
        ".cm-lineNumbers": { fontSize: "13px" },
        // basicSetup's own colours are light-only, so use Starlight's, which follow
        // the site's light/dark switch
        ".cm-gutters": {
            backgroundColor: "var(--sl-color-gray-6)",
            color: "var(--sl-color-gray-3)",
            borderRight: "1px solid var(--sl-color-hairline)",
        },
        ".cm-activeLine": {
            backgroundColor: "color-mix(in srgb, var(--sl-color-accent) 12%, transparent)",
        },
        ".cm-activeLineGutter": {
            backgroundColor: "color-mix(in srgb, var(--sl-color-accent) 20%, transparent)",
            color: "var(--sl-color-white)",
        },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
            backgroundColor: "color-mix(in srgb, var(--sl-color-accent) 30%, transparent)",
        },
        ".cm-cursor": { borderLeftColor: "var(--sl-color-white)" },
    }),
];

// Makes the sample's copy button copy getText(): the text as it is now, with any changes the
// reader has made
export function setUpCopyButton(sample: HTMLElement, getText: () => string) {
    const copyButton = sample.querySelector(".copy button") as HTMLButtonElement;
    const copyFeedback = sample.querySelector(".copy .feedback") as HTMLElement;
    let hideFeedback: ReturnType<typeof setTimeout> | undefined;
    copyButton.addEventListener("click", async () => {
        const text = getText();
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // As Expressive Code's copy button does, fall back to the old way where the
            // Clipboard API isn't allowed
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            const copied = document.execCommand("copy");
            textarea.remove();
            copyButton.focus();
            if (!copied) return;
        }
        copyFeedback.textContent = "Copied!";
        copyFeedback.classList.add("show");
        clearTimeout(hideFeedback);
        hideFeedback = setTimeout(() => {
            copyFeedback.classList.remove("show");
            copyFeedback.textContent = "";
        }, 1500);
    });
}

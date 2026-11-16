// A basic CodeMirror mode for .squiffy files: highlighting only. Everything that needs to know
// what the story means (diagnostics, outline, and later completion, hover, folding and rename)
// comes from the language service, so this never has to agree with the compiler about anything
// more than how a line looks.
import { StreamLanguage, type StringStream } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Every line is highlighted on its own, so there's no state to carry between lines
type State = Record<string, never>;

const SECTION_HEADER = /^\[\[[^\]]*\]\]:/;
const PASSAGE_HEADER = /^\[[^\]]*\]:/;
const SNIPPET_HEADER = /^\[snippet:[^\]]*\]:?/i;
const DIRECTIVE = /^@\w+/;
const DIVIDER = /^(\+\+\+|---)/;

function token(stream: StringStream): string | null {
    if (stream.sol()) {
        if (stream.match(SNIPPET_HEADER) || stream.match(SECTION_HEADER)) {
            return "heading";
        }
        if (stream.match(PASSAGE_HEADER)) {
            return "heading2";
        }
        if (stream.match(DIVIDER)) {
            stream.skipToEnd();
            return "heading";
        }
        if (stream.match(DIRECTIVE)) {
            return "keyword";
        }
        // Lines indented by a tab or four spaces are JavaScript
        if (stream.match(/^(\t| {4})/, false)) {
            stream.skipToEnd();
            return "monospace";
        }
    }

    // Section links [[...]] and passage links [...], with an optional (target) after
    if (stream.match(/^\[\[[^\]]*\]\]/)) {
        stream.match(/^\([^)]*\)/);
        return "link";
    }
    if (stream.match(/^\[[^\]]*\]/)) {
        stream.match(/^\([^)]*\)/);
        return "link";
    }
    // Text processor: {if ...}, {sequence:...}, {@set ...}, {attribute}
    if (stream.match(/^\{[^{}]*/)) {
        stream.eat("}");
        return "processingInstruction";
    }
    if (stream.match(/^<\/?[a-zA-Z][^>]*>/)) {
        return "tagName";
    }
    if (stream.match(/^<!--/)) {
        if (stream.skipTo("-->")) stream.match("-->");
        else stream.skipToEnd();
        return "comment";
    }
    stream.next();
    stream.eatWhile(/[^[{<]/);
    return null;
}

export const squiffyLanguage = StreamLanguage.define<State>({
    name: "squiffy",
    startState: () => ({}),
    token,
    tokenTable: {
        heading: t.heading,
        heading2: t.heading2,
        link: t.link,
        keyword: t.keyword,
        processingInstruction: t.processingInstruction,
        monospace: t.monospace,
        tagName: t.tagName,
        comment: t.comment,
    },
    languageData: {
        commentTokens: { block: { open: "<!--", close: "-->" } },
    },
});

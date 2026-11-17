// A basic CodeMirror mode for .squiffy files: highlighting only. Everything that needs to know
// what the story means (diagnostics, outline, and later completion, hover, folding and rename)
// comes from the language service, so this never has to agree with the compiler about anything
// more than how a line looks.
import { StreamLanguage, type StringStream } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// The one thing carried between lines: as in the compiler (compiler/src/parse.ts), a line indented
// by a tab or four spaces is JavaScript only until the section's or passage's first line of text,
// and the text in a @ui block doesn't count.
interface State {
    textStarted: boolean;
    inUiBlock: boolean;
}

const SECTION_HEADER = /^\[\[[^\]]*\]\]:/;
const PASSAGE_HEADER = /^\[[^\]]*\]:/;
const SNIPPET_HEADER = /^\[snippet:[^\]]*\]:?/i;
const DIRECTIVE = /^@\w+/;
const DIVIDER = /^(\+\+\+|---)/;
// A link's (target), with balanced brackets up to three deep, as in compiler/src/text.ts
const TARGET = /^\((?:[^()]|\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))*?\)/;

function token(stream: StringStream, state: State): string | null {
    if (stream.sol()) {
        if (stream.match(SNIPPET_HEADER) || stream.match(SECTION_HEADER)) {
            state.textStarted = false;
            return "heading";
        }
        if (stream.match(PASSAGE_HEADER)) {
            state.textStarted = false;
            return "heading2";
        }
        if (stream.match(DIVIDER)) {
            state.textStarted = false;
            if (stream.current() == "---") state.inUiBlock = false;
            stream.skipToEnd();
            return "heading";
        }
        if (stream.match(DIRECTIVE)) {
            if (stream.current() == "@ui" && stream.match(/^\s*$/, false)) state.inUiBlock = true;
            return "keyword";
        }
        if (!state.textStarted && stream.match(/^(\t| {4})/, false)) {
            stream.skipToEnd();
            return "monospace";
        }
        if (!state.inUiBlock && stream.match(/^\s*\S/, false)) {
            state.textStarted = true;
        }
    }

    // Section links [[...]] and passage links [...], with an optional (target) after, which can
    // have balanced brackets in it, e.g. [[Buy]](shop, gold -= (price - 1) * 2)
    if (stream.match(/^\[\[[^\]]*\]\]/)) {
        stream.match(TARGET) || stream.match(/^\([^)]*\)/);
        return "link";
    }
    if (stream.match(/^\[[^\]]*\]/)) {
        stream.match(TARGET) || stream.match(/^\([^)]*\)/);
        return "link";
    }
    // Handlebars: {{! comment }}, {{#if ...}}, {{helper ...}}, {{attribute}}, {{{html}}}
    if (stream.match(/^\{\{!--.*?--\}\}/) || stream.match(/^\{\{![^}]*\}\}/)) {
        return "comment";
    }
    if (stream.match(/^\{\{\{?[^}]*\}*/)) {
        return "processingInstruction";
    }
    // Squiffy 5's text processor, which the language service offers to convert: {if ...}, {attribute}
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
    startState: () => ({ textStarted: false, inUiBlock: false }),
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

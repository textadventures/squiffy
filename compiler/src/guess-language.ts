// Guesses the language a story is written in from its text, for a story converted from another
// system that doesn't say (a Twee file or Twine archive, or a Quest gamebook), so its squiffy.json
// can have a "language". It only answers when the text makes it clear: a story in a writing system
// only one language here uses, or one whose commonest words are clearly one language's. Otherwise
// undefined, and the story has no language, which the author can set in Story details.

// Writing systems that, among the languages here, mean one language. Only their letters count: a
// script's other characters are sometimes used for decoration, such as U+0489 in Cyrillic.
const SCRIPTS: [RegExp, string][] = [
    [/[\p{Script=Hiragana}\p{Script=Katakana}]/gu, "ja"],
    [/\p{Script=Hangul}/gu, "ko"],
    [/(?=\p{L})\p{Script=Han}/gu, "zh"],
    [/(?=\p{L})\p{Script=Greek}/gu, "el"],
    [/(?=\p{L})\p{Script=Thai}/gu, "th"],
    [/(?=\p{L})\p{Script=Cyrillic}/gu, "ru"],
];

// Each language's commonest short words, which a page of its prose is full of
const COMMON_WORDS: Record<string, string> = {
    en: "the and of to a in is it you that he was for on are with as his they at be this have from or had by but not what all were we when your can said there an which she do their if will up out them then so my me her him",
    fr: "le la les de des et est un une du en que qui dans pour pas vous il elle ne sur au avec ce se sont mais nous je tu son sa ses leur ou cette était",
    de: "der die das und ist nicht ein eine zu den von mit sich des auf für im dem sie es ich du er wir aber auch als wie noch nach war hat",
    es: "el la los las de y que en un una es no por con para se lo su al del pero más como mi te le está muy yo tu sus",
    it: "il la di che e è un una per non con del della sono si ma ti mi lo gli le da nel alla anche come io tu sei hai",
    pt: "o a os as de que e do da em um uma não para com se por mais na no dos das você eu ao mas está ele ela é",
    nl: "de het een en van is dat niet in op te zijn ik je met voor er maar ook als aan bij wat hij zij we",
    sv: "och att det som en på är av för med den inte till har jag du om men ett var vi de hon han kan",
    da: "og at det som en på er af for med den ikke til har jeg du om men et var vi de hun han kan",
    nb: "og at det som en på er av for med den ikke til har jeg du om men et var vi de hun han kan",
    pl: "i w nie na się to że z do jest jak co ale ja ty on ona po tak już przez dla czy",
    tr: "bir ve bu da de için ile ne çok ben sen o değil gibi daha ama var mı",
};
const WORDS = Object.fromEntries(Object.entries(COMMON_WORDS).map(([tag, words]) => [tag, new Set(words.split(" "))]));

// Below this many words, there isn't enough to go on
const MIN_WORDS = 100;

export function guessLanguage(text: string): string | undefined {
    // Accents are part of their letters, and other marks (such as decoration) are dropped, so they
    // don't split words
    text = text.normalize("NFC").replace(/\p{M}/gu, "");
    const letters = (text.match(/\p{L}/gu) ?? []).length;
    if (!letters) return undefined;
    for (const [pattern, tag] of SCRIPTS) {
        // Most of the letters, so a few words in another script, such as a name, don't count
        if ((text.match(pattern) ?? []).length > letters * 0.3) {
            // Kana means Japanese even when there are more kanji
            if (tag == "zh" && (text.match(SCRIPTS[0][0]) ?? []).length > letters * 0.05) return "ja";
            if (tag == "ru") return cyrillicLanguage(text);
            return tag;
        }
    }

    const words = (text.toLowerCase().match(/\p{L}+/gu) ?? []);
    if (words.length < MIN_WORDS) return undefined;
    const scores = Object.entries(WORDS)
        .map(([tag, common]) => ({ tag, score: words.filter(w => common.has(w)).length / words.length }))
        .sort((a, b) => b.score - a.score);
    const [best, next] = scores;
    // Prose has plenty of these words, and clearly more of one language's than any other's
    return best.score >= 0.15 && best.score >= next.score * 1.5 ? best.tag : undefined;
}

// Which language Cyrillic text is in, by the letters only some of them use: Ukrainian's і, ї, є
// and ґ, Serbian's ј, љ, њ, ћ, ђ and џ, and Russian's ы and э, which Bulgarian doesn't have but
// for which it has plenty of ъ. Undefined for anything else, such as Belarusian, which has ы too.
function cyrillicLanguage(text: string): string | undefined {
    const lower = text.toLowerCase();
    const letters = (lower.match(/\p{Script=Cyrillic}/gu) ?? []).length;
    const share = (pattern: RegExp) => (lower.match(pattern) ?? []).length / letters;
    if (share(/[іїєґ]/gu) > 0.01) return share(/ў/gu) > 0.001 ? undefined : "uk";
    if (share(/[јљњћђџ]/gu) > 0.005) return "sr";
    if (share(/ў/gu) > 0.001) return undefined;
    if (share(/[ыэ]/gu) > 0.005) return "ru";
    if (share(/ъ/gu) > 0.005) return "bg";
    return undefined;
}

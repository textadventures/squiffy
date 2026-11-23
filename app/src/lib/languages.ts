// The languages Story details offers for squiffy.json's "language", as BCP 47 tags. These are the
// ones textadventures.co.uk lists games by, so a story published there arrives with its language
// chosen. Any other tag can be typed in.
import { languageTag } from "squiffy-compiler";

export const LANGUAGES = [
    "en", "zh", "hr", "da", "nl", "eo", "fr", "de", "el", "hu", "is", "it", "ja", "ko", "la", "nb", "pl",
    "pt-BR", "pt-PT", "ro", "ru", "es", "sv", "th", "tr",
] as const;

// A language's name in English, with its own name after it when that's different, such as
// "French — français". The tag itself if the browser doesn't know it.
export function languageName(tag: string): string {
    const name = (locale: string) => {
        try {
            const result = new Intl.DisplayNames([locale], { type: "language" }).of(tag);
            return result && result !== tag ? result : null;
        } catch {
            return null;
        }
    };
    const english = name("en");
    if (!english) return tag;
    const own = name(tag);
    return own && own.toLowerCase() !== english.toLowerCase() ? `${english} — ${own}` : english;
}

// The offered languages in order of their names, with their names
export function languageOptions(): { tag: string; name: string }[] {
    return LANGUAGES.map(tag => ({ tag: tag as string, name: languageName(tag) })).sort((a, b) => a.name.localeCompare(b.name, "en"));
}

// The offered language nearest the browser's own, to suggest for a story that has none:
// "fr-CA" suggests French, and "pt-BR" Brazilian Portuguese
export function suggestedLanguage(browserLanguages: readonly string[]): string | undefined {
    for (const browser of browserLanguages) {
        const tag = languageTag(browser);
        if (!tag) continue;
        const exact = LANGUAGES.find(l => l.toLowerCase() === tag.toLowerCase());
        if (exact) return exact;
        const base = tag.split("-")[0];
        if (base === "pt") return "pt-PT";
        if (base === "no" || base === "nn") return "nb";
        const match = LANGUAGES.find(l => l === base);
        if (match) return match;
    }
    return undefined;
}

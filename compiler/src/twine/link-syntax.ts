// A link written as Twine writes it, pasted into a Squiffy story (#711): [[text->target]],
// [[target<-text]] or [[text|target]]. Squiffy reads each as a link to a section with that whole
// name, so the language service says what was meant and offers [[text]](target) in its place.

export interface TwineLinkParts {
    text: string;
    target: string;
}

// The text and target of a [[...]] link's inside, if it's in one of Twine's forms, as Harlowe reads
// them: the last "->", else the first "<-", else the last "|". Null if it isn't, or if either side
// is empty, or if it's a SugarCube link with a setter ([[text|target][$x to 1]]), which has no
// Squiffy equivalent to offer.
export function twineLinkParts(inner: string): TwineLinkParts | null {
    if (inner.includes("][")) return null;
    let text: string;
    let target: string;
    const arrow = inner.lastIndexOf("->");
    const back = inner.indexOf("<-");
    const bar = inner.lastIndexOf("|");
    if (arrow != -1) {
        text = inner.substring(0, arrow);
        target = inner.substring(arrow + 2);
    }
    else if (back != -1) {
        target = inner.substring(0, back);
        text = inner.substring(back + 2);
    }
    else if (bar != -1) {
        text = inner.substring(0, bar);
        target = inner.substring(bar + 1);
    }
    else {
        return null;
    }
    text = text.trim();
    target = target.trim();
    if (!text || !target) return null;
    return { text, target };
}

// The Squiffy link for it: [[target]] when the text is the target, else [[text]](target)
export function squiffyLinkFor(parts: TwineLinkParts): string {
    return parts.text == parts.target ? `[[${parts.target}]]` : `[[${parts.text}]](${parts.target})`;
}

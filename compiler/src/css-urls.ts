// The url()s in a story's own stylesheets, such as a font's files or a background image. A
// stylesheet refers to them by their path from its own folder, as a web page's CSS does. That
// works as it is in a published story, whose stylesheets are separate files, but a one-file
// export or the editor's preview has to swap each for something it can load.

const URL_PATTERN = /url\(\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|([^)"'\s]*))\s*\)/gi;

// A url() that's a path to a file beside the stylesheet, rather than a web address, a data: URI,
// an absolute path or a reference to an SVG element like "#gradient"
export function isRelativeUrl(url: string): boolean {
    return url != "" && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url);
}

// Replaces each relative url() in css with what replace returns for it, or leaves it as it is if
// replace returns undefined
export function rewriteCssUrls(css: string, replace: (url: string) => string | undefined): string {
    return css.replace(URL_PATTERN, (match, double?: string, single?: string, bare?: string) => {
        const url = (double ?? single ?? bare ?? "").trim();
        if (!isRelativeUrl(url)) return match;
        const replacement = replace(url);
        return replacement === undefined ? match : `url("${replacement.replace(/["\\\n]/g, c => c == "\n" ? "\\a " : `\\${c}`)}")`;
    });
}

// The relative url()s in css
export function findCssUrls(css: string): string[] {
    const urls: string[] = [];
    rewriteCssUrls(css, url => {
        urls.push(url);
        return undefined;
    });
    return urls;
}

// The path, from the story's folder, of a url() in the stylesheet at sheetPath (also from the
// story's folder), e.g. "fonts/literata/latin-400-normal.woff2" for "latin-400-normal.woff2" in
// "fonts/literata/literata.css". Null if it's outside the story's folder. A query or #fragment,
// such as the "?#iefix" some older @font-face rules have, isn't part of the path.
export function resolveCssUrl(sheetPath: string, url: string): string | null {
    let path = url.replace(/[?#].*$/, "");
    try {
        path = decodeURI(path);
    }
    catch {
        // Not valid percent-encoding: use it as it is
    }
    const sheet = sheetPath.replace(/\\/g, "/").split("/");
    sheet.pop();
    const parts = sheet.filter(part => part != "" && part != ".");
    for (const part of path.replace(/\\/g, "/").split("/")) {
        if (part == "" || part == ".") continue;
        if (part == "..") {
            if (!parts.length || parts[parts.length - 1] == "..") return null;
            parts.pop();
        }
        else {
            parts.push(part);
        }
    }
    return parts.length ? parts.join("/") : null;
}

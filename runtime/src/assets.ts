// Support for the resolveAssetUrl init option, which maps asset paths in story output (e.g. "cat.png")
// to the URLs they should load from (e.g. a blob: URL in the editor preview, or a data: URI in a
// single-file export).
//
// We rewrite the HTML string before it's inserted into the page, so the browser never requests the
// unresolved path. The original value is kept in a data-squiffy-asset-* attribute, so that output
// saved to localStorage (which will contain resolved URLs that may no longer be valid, e.g. blob: URLs)
// can be resolved again when it's restored.

export type AssetUrlResolver = (path: string) => string;

// Attributes that contain a single URL.
const urlAttributes = ["src", "poster"];

const originalPrefix = "data-squiffy-asset-";

const selector = [...urlAttributes, "srcset", "style"].map(a => `[${a}]`).join(",");

// Anything with a scheme (http:, https:, data:, blob:, mailto: etc.), protocol-relative URLs,
// and fragment-only references are left alone.
const isAbsolute = (url: string) => /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//") || url.startsWith("#");

const resolveUrl = (url: string, resolve: AssetUrlResolver): string => {
    const trimmed = url.trim();
    if (!trimmed || isAbsolute(trimmed)) return url;
    let path = trimmed;
    try {
        // Markdown (and authors) may percent-encode paths, e.g. "my%20cat.png". The resolver
        // works with file paths, so give it "my cat.png".
        path = decodeURI(trimmed);
    } catch {
        // Not valid percent-encoding - pass it through as it is
    }
    return resolve(path);
};

// srcset is a comma-separated list of "url [descriptor]" candidates.
const resolveSrcset = (srcset: string, resolve: AssetUrlResolver) =>
    srcset.split(",").map(candidate => {
        const match = candidate.match(/^(\s*)(\S+)(.*)$/s);
        if (!match) return candidate;
        return match[1] + resolveUrl(match[2], resolve) + match[3];
    }).join(",");

// CSS url(...) references in inline style attributes.
const resolveCssUrls = (css: string, resolve: AssetUrlResolver) =>
    css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (whole, _quote: string, url: string) => {
        const resolved = resolveUrl(url, resolve);
        if (resolved === url) return whole;
        return `url("${resolved.replace(/["\\\n]/g, c => "\\" + (c === "\n" ? "a " : c))}")`;
    });

const resolveAttribute = (el: Element, attribute: string, resolve: AssetUrlResolver) => {
    const originalAttribute = originalPrefix + attribute;
    const original = el.getAttribute(originalAttribute) ?? el.getAttribute(attribute);
    if (original === null) return;

    let resolved: string;
    if (attribute === "srcset") {
        resolved = resolveSrcset(original, resolve);
    } else if (attribute === "style") {
        resolved = resolveCssUrls(original, resolve);
    } else {
        resolved = resolveUrl(original, resolve);
    }

    if (resolved === original) {
        el.removeAttribute(originalAttribute);
    } else {
        el.setAttribute(originalAttribute, original);
    }
    el.setAttribute(attribute, resolved);
};

// Returns a function that rewrites asset URLs in an HTML string. With no resolver, HTML is returned unchanged.
export const createAssetHtmlResolver = (resolve: AssetUrlResolver | undefined) => (html: string): string => {
    if (!resolve) return html;
    // Quick check to avoid parsing HTML that can't contain anything to resolve.
    if (!/\b(src|srcset|poster|style)\s*=/i.test(html)) return html;

    // A <template>'s content is inert, so parsing into it doesn't start loading any images.
    const template = document.createElement("template");
    template.innerHTML = html;
    for (const el of template.content.querySelectorAll(selector)) {
        for (const attribute of [...urlAttributes, "srcset", "style"]) {
            if (el.hasAttribute(attribute)) {
                resolveAttribute(el, attribute, resolve);
            }
        }
    }
    return template.innerHTML;
};

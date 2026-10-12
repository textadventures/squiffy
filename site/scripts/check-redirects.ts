// Validates public/_redirects against the built site. Run after `astro build`
// (it inspects dist/); `npm run build` does this.
//
// Fails if:
//   - public/_redirects has more than 100 rules. Cloudflare Pages silently
//     ignores everything past the first 100.
//   - a rule's source is a real page. Pages applies redirects before serving
//     assets, so the page could never be reached.
//   - a rule's target page, or its #anchor, doesn't exist - e.g. because a
//     heading was renamed
//   - a page of the old Squiffy 5 docs site (listed in legacy-docs-paths.txt)
//     doesn't end up at a page here

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const siteDir = path.join(__dirname, "..");
const distDir = path.join(siteDir, "dist");

const CLOUDFLARE_REDIRECTS_LIMIT = 100;

if (!fs.existsSync(distDir)) {
    console.error("site/dist not found - run `npm run build` in site/ first.");
    process.exit(1);
}

const problems: string[] = [];

interface Rule {
    from: string;
    to: string;
    // For a "/foo/*" rule, the "/foo/" that a path must start with
    prefix: string | null;
}

const rules: Rule[] = fs.readFileSync(path.join(siteDir, "public", "_redirects"), "utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"))
    .map(line => {
        const [from, to] = line.split(/\s+/);
        return { from, to, prefix: from.endsWith("/*") ? from.slice(0, -1) : null };
    });

if (rules.length > CLOUDFLARE_REDIRECTS_LIMIT) {
    problems.push(`public/_redirects has ${rules.length} rules; Cloudflare Pages honours only the first ${CLOUDFLARE_REDIRECTS_LIMIT}.`);
}

// The built page for a URL path, if there is one
const pageFor = (urlPath: string) => {
    const clean = urlPath.split("#")[0].replace(/^\/|\/$/g, "");
    const candidates = [path.join(distDir, clean, "index.html"), path.join(distDir, `${clean}.html`)];
    return candidates.find(file => fs.existsSync(file)) ?? null;
};

for (const { from, to, prefix } of rules) {
    if (!prefix && pageFor(from)) {
        problems.push(`rule source is a real page, which the rule would hide: ${from}`);
    }

    if (/^https?:/.test(to)) continue;

    const page = pageFor(to);
    if (!page) {
        problems.push(`rule target is not a page: ${from} -> ${to}`);
        continue;
    }

    const anchor = to.split("#")[1];
    if (anchor && !fs.readFileSync(page, "utf8").includes(`id="${anchor}"`)) {
        problems.push(`rule target's anchor is not on the page: ${from} -> ${to}`);
    }
}

// Follow the rules the way Cloudflare does (first match wins)
const resolve = (urlPath: string) => {
    for (const { from, to, prefix } of rules) {
        if (urlPath === from || (prefix && urlPath.startsWith(prefix))) return to;
    }
    return urlPath;
};

const legacyPaths = fs.readFileSync(path.join(__dirname, "legacy-docs-paths.txt"), "utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));

for (const legacyPath of legacyPaths) {
    const target = resolve(legacyPath);
    if (!/^https?:/.test(target) && !pageFor(target)) {
        problems.push(`old docs page does not resolve: ${legacyPath} -> ${target}`);
    }
}

if (problems.length > 0) {
    console.error(`\n${problems.length} redirect problem(s):\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error("");
    process.exit(1);
}

console.log(`OK: ${rules.length} redirect rules (limit ${CLOUDFLARE_REDIRECTS_LIMIT}), and all ${legacyPaths.length} old docs pages resolve.`);

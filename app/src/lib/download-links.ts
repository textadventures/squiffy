// The desktop app's downloads (#276), for the home page's Desktop app button, with the installer for
// the visitor's system first. From Quest Viva's src/AppShell/src/lib/download-links.ts. The same
// rules as the docs site's site/src/components/DownloadButton.astro: the stable app offers GitHub's
// latest release, and the beta app (a prerelease built with VITE_BETA_APP) the newest prerelease,
// Squiffy Beta. Never shown in the desktop app, which tells the author about updates itself
// (desktop-updates.svelte.ts).
import { isBetaApp } from "./channel.js";

const REPO_API = "https://api.github.com/repos/textadventures/squiffy";
const RELEASES_PAGE_URL = isBetaApp
    ? "https://github.com/textadventures/squiffy/releases"
    : "https://github.com/textadventures/squiffy/releases/latest";

// Only so the home page doesn't fetch it again each time it's visited during one session
const CACHE_KEY = isBetaApp ? "squiffy-latest-prerelease" : "squiffy-latest-release";
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface DownloadLink {
    label: string;
    url: string;
}

export interface DownloadLinks {
    version: string | null;
    releaseDate: string | null;
    primary: DownloadLink | null;
    others: DownloadLink[];
    releasePage: string;
}

export interface ReleaseAsset {
    name: string;
    browser_download_url: string;
}

export interface Release {
    tag_name: string;
    html_url?: string;
    published_at: string;
    prerelease?: boolean;
    draft?: boolean;
    assets: ReleaseAsset[];
}

export type DetectedOs = "Windows" | "Mac" | "Linux" | null;

export function detectOs(userAgent: string): DetectedOs {
    if (/Windows/.test(userAgent)) return "Windows";
    if (/Mac OS X|Macintosh/.test(userAgent)) return "Mac";
    if (/Linux/.test(userAgent)) return "Linux";
    return null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
    const response = await fetch(url);
    return response.ok ? (await response.json()) as T : null;
}

const hasInstallers = (release: Release) => release.assets.some(a => /\.(dmg|exe)$/i.test(a.name));

// The beta app wants the newest prerelease with installers (the list is newest first), or failing
// that the stable release
async function fetchRelease(): Promise<Release | null> {
    if (isBetaApp) {
        const releases = await fetchJson<Release[]>(`${REPO_API}/releases?per_page=30`);
        const prerelease = releases?.find(r => r.prerelease && !r.draft && hasInstallers(r));
        if (prerelease) return prerelease;
    }
    return fetchJson<Release>(`${REPO_API}/releases/latest`);
}

// By extension, since the version is in every file name. wantArm64 picks the x64 or arm64 Linux
// build; the Mac build is only arm64.
function findAsset(assets: ReleaseAsset[], extension: string, wantArm64?: boolean): ReleaseAsset | null {
    return assets.find(a => {
        const name = a.name.toLowerCase();
        return name.endsWith(extension) && (wantArm64 === undefined || name.includes("arm64") === wantArm64);
    }) ?? null;
}

function formatReleaseDate(iso: string): string | null {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function buildLinks(release: Release, detected: DetectedOs, releasePage = RELEASES_PAGE_URL): DownloadLinks {
    // .deb first on Linux: an AppImage doesn't add itself to the desktop's list of apps
    const candidates = [
        { os: "Windows", label: "Windows", asset: findAsset(release.assets, ".exe") },
        { os: "Mac", label: "Mac (Apple Silicon)", asset: findAsset(release.assets, ".dmg") },
        { os: "Linux", label: "Linux (.deb)", asset: findAsset(release.assets, ".deb", false) },
        { os: "Linux", label: "Linux (AppImage)", asset: findAsset(release.assets, ".appimage", false) },
        { os: "Linux-arm64", label: "Linux on Arm (.deb)", asset: findAsset(release.assets, ".deb", true) },
        { os: "Linux-arm64", label: "Linux on Arm (AppImage)", asset: findAsset(release.assets, ".appimage", true) },
    ];
    const primaryEntry = detected ? candidates.find(c => c.os === detected && c.asset) : undefined;
    return {
        version: release.tag_name,
        releaseDate: formatReleaseDate(release.published_at),
        primary: primaryEntry?.asset ? { label: `Download for ${primaryEntry.label}`, url: primaryEntry.asset.browser_download_url } : null,
        others: candidates
            .filter(c => c !== primaryEntry && c.asset)
            .map(c => ({ label: c.label, url: c.asset!.browser_download_url })),
        // The beta's own release page, since releases/latest is always the stable one
        releasePage: isBetaApp && release.html_url ? release.html_url : releasePage,
    };
}

const fallbackLinks = (): DownloadLinks => ({ version: null, releaseDate: null, primary: null, others: [], releasePage: RELEASES_PAGE_URL });

export async function fetchDownloadLinks(): Promise<DownloadLinks> {
    const detected = detectOs(navigator.userAgent);
    try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
            const { fetchedAt, release } = JSON.parse(cached) as { fetchedAt: number; release: Release };
            if (Date.now() - fetchedAt < CACHE_TTL_MS) return buildLinks(release, detected);
        }
    } catch {
        // No sessionStorage, or a corrupt entry: fetch it again
    }
    try {
        const release = await fetchRelease();
        // A release whose installers haven't been attached yet: just the link to the releases page
        if (!release || !hasInstallers(release)) return fallbackLinks();
        try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), release }));
        } catch {
            // Not worth failing over
        }
        return buildLinks(release, detected);
    } catch {
        return fallbackLinks();
    }
}

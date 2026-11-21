// Games made with Squiffy, for the home page: the ones featured on textadventures.co.uk, where
// they're published, chosen by its admins. The call says which editor this is (web or desktop, its
// version, and the desktop app's OS), which is how textadventures.co.uk counts the editor's use.
//
// The last list is kept, so the games show straight away next time while it's fetched again. If it
// can't be fetched (offline, or the site's down), they're not shown, since the games are on the
// site: a link or cover that won't load is no use.
import { desktopApi } from "./desktop.js";

// VITE_FEATURED_API_URL points a development build at a local copy of textadventures.co.uk
export const FEATURED_API_URL: string = import.meta.env.VITE_FEATURED_API_URL || "https://textadventures.co.uk/api/featured/squiffy";
const CACHE_KEY = "squiffy-featured-games";
// How many of the featured games the home page shows at once
export const FEATURED_SHOWN = 4;

export interface FeaturedGame {
    id: string;
    name: string;
    author?: string;
    // The reason it's featured, or the start of its description
    description?: string;
    cover: string;
    // The game's page on textadventures.co.uk
    url: string;
}

export const featuredGames = $state({ games: [] as FeaturedGame[] });

export function featuredApiUrl(base: string, client: { source: "web" | "electron"; version: string; platform?: string }): string {
    const url = new URL(base);
    url.searchParams.set("source", client.source);
    url.searchParams.set("version", client.version);
    if (client.platform) url.searchParams.set("platform", client.platform);
    return url.toString();
}

const isHttpUrl = (value: unknown): value is string => {
    if (typeof value !== "string") return false;
    try {
        return ["https:", "http:"].includes(new URL(value).protocol);
    } catch {
        return false;
    }
};

const optionalString = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;

// The games in api/featured's response, leaving out any that aren't as expected, and any link that
// isn't to a web page (so the page never gets a javascript: link from it)
export function parseFeaturedGames(data: unknown): FeaturedGame[] {
    const games = (data as { games?: unknown } | null)?.games;
    if (!Array.isArray(games)) return [];
    return games.flatMap((game: Record<string, unknown> | null): FeaturedGame[] => {
        if (!game || typeof game.id !== "string" || typeof game.name !== "string" || !isHttpUrl(game.url) || !isHttpUrl(game.cover)) return [];
        return [{
            id: game.id,
            name: game.name,
            author: optionalString(game.author),
            description: optionalString(game.description),
            cover: game.cover,
            url: game.url,
        }];
    });
}

// `count` of the games, chosen at random, in their featured order
export function chooseFeaturedGames<T>(games: T[], count: number, random: () => number = Math.random): T[] {
    if (games.length <= count) return games;
    const indexes = games.map((_, i) => i);
    for (let i = indexes.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
    }
    return indexes.slice(0, count).sort((a, b) => a - b).map(i => games[i]);
}

function readCache(): FeaturedGame[] {
    try {
        return parseFeaturedGames(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null"));
    } catch {
        return [];
    }
}

function writeCache(games: FeaturedGame[]) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ games }));
    } catch {
        // No storage: they're just fetched before they're shown
    }
}

/** Shows the last list, then fetches it again. Called when the home page opens. */
export async function loadFeaturedGames(): Promise<void> {
    featuredGames.games = chooseFeaturedGames(readCache(), FEATURED_SHOWN);
    const api = desktopApi();
    const url = featuredApiUrl(FEATURED_API_URL, {
        source: api ? "electron" : "web",
        version: __APP_VERSION__,
        platform: api?.desktop.platform,
    });
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const games = parseFeaturedGames(await response.json());
        writeCache(games);
        // Keep the ones already showing if they're still featured, so the page doesn't shuffle
        // under the author
        const ids = new Set(games.map(g => g.id));
        const showing = featuredGames.games.filter(g => ids.has(g.id));
        featuredGames.games = showing.length === Math.min(FEATURED_SHOWN, games.length)
            ? games.filter(g => showing.some(s => s.id === g.id))
            : chooseFeaturedGames(games, FEATURED_SHOWN);
    } catch {
        featuredGames.games = [];
    }
}

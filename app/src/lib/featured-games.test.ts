import { describe, expect, test } from "vitest";
import { chooseFeaturedGames, featuredApiUrl, parseFeaturedGames } from "./featured-games.svelte.js";

describe("featuredApiUrl", () => {
    test("says which editor is asking", () => {
        expect(featuredApiUrl("https://textadventures.co.uk/api/featured/squiffy", { source: "web", version: "7.0.0" }))
            .toBe("https://textadventures.co.uk/api/featured/squiffy?source=web&version=7.0.0");
    });

    test("with the desktop app's OS", () => {
        expect(featuredApiUrl("https://textadventures.co.uk/api/featured/squiffy", { source: "electron", version: "7.1.0-beta.1", platform: "mac" }))
            .toBe("https://textadventures.co.uk/api/featured/squiffy?source=electron&version=7.1.0-beta.1&platform=mac");
    });
});

describe("parseFeaturedGames", () => {
    const game = {
        id: "abc",
        name: "A Game",
        author: "Ada",
        description: "Why it's featured.",
        cover: "https://media.textadventures.co.uk/coverart/abc.webp",
        url: "https://textadventures.co.uk/games/view/abc/a-game",
        rating: 4.5,
        numberReviews: 3,
        language: "en",
    };

    test("keeps what the home page shows", () => {
        expect(parseFeaturedGames({ games: [game] })).toEqual([{
            id: "abc",
            name: "A Game",
            author: "Ada",
            description: "Why it's featured.",
            cover: "https://media.textadventures.co.uk/coverart/abc.webp",
            url: "https://textadventures.co.uk/games/view/abc/a-game",
        }]);
    });

    test("leaves out an empty author or description", () => {
        const [parsed] = parseFeaturedGames({ games: [{ ...game, author: null, description: "  " }] });
        expect(parsed.author).toBeUndefined();
        expect(parsed.description).toBeUndefined();
    });

    test("leaves out games that aren't as expected", () => {
        expect(parseFeaturedGames({
            games: [
                null,
                { ...game, id: 1 },
                { ...game, name: undefined },
                { ...game, url: "javascript:alert(1)" },
                { ...game, cover: "not a url" },
                { ...game, id: "kept" },
            ],
        }).map(g => g.id)).toEqual(["kept"]);
    });

    test.each([null, undefined, "nope", {}, { games: "nope" }])("%s has no games", (data) => {
        expect(parseFeaturedGames(data)).toEqual([]);
    });
});

describe("chooseFeaturedGames", () => {
    test("all of them when there aren't more than asked for", () => {
        expect(chooseFeaturedGames([1, 2, 3], 4)).toEqual([1, 2, 3]);
    });

    test("some of them, in their featured order", () => {
        const games = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        for (let i = 0; i < 20; i++) {
            const chosen = chooseFeaturedGames(games, 4);
            expect(chosen).toHaveLength(4);
            expect(new Set(chosen).size).toBe(4);
            expect([...chosen].sort((a, b) => a - b)).toEqual(chosen);
        }
    });

    test("at random", () => {
        const games = [1, 2, 3, 4, 5, 6];
        expect(chooseFeaturedGames(games, 2, () => 0)).not.toEqual(chooseFeaturedGames(games, 2, () => 0.99));
    });
});

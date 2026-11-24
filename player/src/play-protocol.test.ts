import { describe, expect, test } from "vitest";
import { isEditorOrigin, isReadyMessage, playMessage, readyMessage, storyInPlayMessage } from "./play-protocol.ts";

describe("play messages", () => {
    test("a play message carries the story's page", () => {
        expect(storyInPlayMessage(playMessage("<p>Hello</p>"))).toBe("<p>Hello</p>");
        expect(isReadyMessage(readyMessage())).toBe(true);
    });

    test("anything else isn't one", () => {
        expect(storyInPlayMessage(readyMessage())).toBeNull();
        expect(storyInPlayMessage({ channel: "squiffy-preview", type: "play", version: 1, html: "x" })).toBeNull();
        expect(storyInPlayMessage({ channel: "squiffy-play", type: "play", version: 1, html: 5 })).toBeNull();
        expect(storyInPlayMessage({ channel: "squiffy-play", type: "play", html: "x" })).toBeNull();
        expect(storyInPlayMessage("<p>Hello</p>")).toBeNull();
        expect(storyInPlayMessage(null)).toBeNull();
        expect(isReadyMessage(playMessage("x"))).toBe(false);
    });
});

describe("isEditorOrigin", () => {
    test("the editors, and the beta's preview deployments", () => {
        expect(isEditorOrigin("https://app.squiffystory.com")).toBe(true);
        expect(isEditorOrigin("https://app-beta.squiffystory.com")).toBe(true);
        expect(isEditorOrigin("https://1a2b3c4d.squiffy.pages.dev")).toBe(true);
        expect(isEditorOrigin("https://my-branch.squiffy.pages.dev")).toBe(true);
    });

    test("not anywhere else", () => {
        expect(isEditorOrigin("https://squiffystory.com")).toBe(false);
        expect(isEditorOrigin("http://app.squiffystory.com")).toBe(false);
        expect(isEditorOrigin("https://app.squiffystory.com.example.com")).toBe(false);
        expect(isEditorOrigin("https://evil.pages.dev")).toBe(false);
        expect(isEditorOrigin("https://a.b.squiffy.pages.dev")).toBe(false);
        expect(isEditorOrigin("https://squiffystories.com")).toBe(false);
        expect(isEditorOrigin("null")).toBe(false);
    });

    test("an editor on this machine, only in development", () => {
        expect(isEditorOrigin("http://localhost:5180")).toBe(false);
        expect(isEditorOrigin("http://localhost:5180", true)).toBe(true);
        expect(isEditorOrigin("http://127.0.0.1:5188", true)).toBe(true);
        expect(isEditorOrigin("http://localhost.example.com", true)).toBe(false);
    });
});

import { describe, expect, test, vi } from "vitest";

vi.mock("vscode", () => ({}));

const { notificationText, withCsp } = await import("./preview.js");

describe("notificationText", () => {
    test("a story's text can't make a link in a notification", () => {
        expect(notificationText("Click [here](command:workbench.action.terminal.new) to fix it"))
            .toBe("Click [here] (command:workbench.action.terminal.new) to fix it");
        expect(notificationText("x is undefined")).toBe("x is undefined");
    });
});

// The preview's webview can load any file in the workspace, as an image, sound or font, but the
// story can't read what's in one: it can't fetch, and its scripts only come from itself
test("the story in the preview can't fetch, or load scripts from files", () => {
    const html = withCsp("<head></head>", "https://file+.vscode-resource.vscode-cdn.net");
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain("connect-src");
    expect(html).toContain("script-src 'unsafe-inline' 'unsafe-eval' blob:\"");
});

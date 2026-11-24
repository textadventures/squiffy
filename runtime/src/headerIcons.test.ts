import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { BACK_ICON, MUTE_ICONS, RESTART_ICON, THEME_ICONS } from "./headerIcons.js";

// The published page's header, which has its own copies of the icons
const template = readFileSync(new URL("../../packager/src/index.template.html", import.meta.url), "utf8");

describe("header icons", () => {
    test.each([
        ["Back", BACK_ICON],
        ["Restart", RESTART_ICON],
        ["mute", MUTE_ICONS],
        ["light/dark", THEME_ICONS],
    ])("the %s icon is the published page's", (_name, icon) => {
        for (const svg of icon.match(/<svg[\s\S]*?<\/svg>/g)!) {
            expect(template).toContain(svg);
        }
    });
});

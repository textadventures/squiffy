import { describe, expect, test } from "vitest";
import fs from "fs";
import { PAGE_STRINGS, PANEL_ICONS, PLAYER_SETTING_TYPES, PROJECT_FILE_VERSION, PROJECT_PROPERTIES, PROJECT_SCHEMA_URL } from "./project.js";

// The JSON schema for squiffy.json, which the docs site publishes for editors such as VS Code, must
// say what parseProjectFile() accepts (#642)
const schema = JSON.parse(fs.readFileSync(new URL("../../site/public/schema/squiffy.json", import.meta.url), "utf8"));

describe("the squiffy.json schema", () => {
    test("is published where new project files say", () => {
        expect(schema.$id).toBe(PROJECT_SCHEMA_URL);
    });

    test("has every property the project file can have, and no others", () => {
        expect(Object.keys(schema.properties).sort()).toEqual([...PROJECT_PROPERTIES].sort());
        expect(schema.additionalProperties).toBe(false);
    });

    test("has the version", () => {
        expect(schema.properties.version.enum).toEqual([PROJECT_FILE_VERSION]);
    });

    test("has every page string", () => {
        expect(Object.keys(schema.properties.strings.properties).sort()).toEqual(Object.keys(PAGE_STRINGS).sort());
    });

    test("has every panel icon and position", () => {
        const panel = schema.properties.panels.items.properties;
        expect(panel.icon.enum).toEqual([...PANEL_ICONS]);
        expect(panel.position.enum).toEqual(["side", "button"]);
    });

    test("has every kind of setting", () => {
        expect(schema.properties.settings.items.properties.type.enum).toEqual([...PLAYER_SETTING_TYPES]);
    });
});

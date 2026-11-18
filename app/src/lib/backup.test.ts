import { describe, expect, it } from "vitest";
import { needsBackup } from "./backup.js";

const DAY = 24 * 60 * 60 * 1000;

describe("needsBackup", () => {
    it("doesn't remind about a story that hasn't been changed", () => {
        expect(needsBackup({}, 100 * DAY)).toBe(false);
    });

    it("reminds once a story has been changed", () => {
        expect(needsBackup({ lastEdited: 1 }, 1)).toBe(true);
    });

    it("waits a week after the reminder is resolved", () => {
        expect(needsBackup({ lastEdited: 3 * DAY, backupReminderResolved: 2 * DAY }, 3 * DAY)).toBe(false);
        expect(needsBackup({ lastEdited: 3 * DAY, backupReminderResolved: 2 * DAY }, 9 * DAY)).toBe(true);
    });

    it("doesn't remind when nothing has changed since the last download", () => {
        expect(needsBackup({ lastEdited: 1 * DAY, backupReminderResolved: 2 * DAY }, 30 * DAY)).toBe(false);
    });
});

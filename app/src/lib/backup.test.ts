import { describe, expect, it } from "vitest";
import { needsBackup } from "./backup.js";

const DAY = 24 * 60 * 60 * 1000;
// Noon on a day, local time, so a few hours either way stays on that day
const day = (n: number, hours = 0) => new Date(2026, 0, n, 12 + hours).getTime();

describe("needsBackup", () => {
    it("doesn't remind about a story that hasn't been changed", () => {
        expect(needsBackup({}, day(100))).toBe(false);
    });

    it("doesn't remind about a story only changed on the day it was made", () => {
        expect(needsBackup({ firstEdited: day(1), lastEdited: day(1, 5) }, day(1, 5))).toBe(false);
    });

    it("reminds once a story has been changed on another day", () => {
        expect(needsBackup({ firstEdited: day(1), lastEdited: day(2) }, day(2))).toBe(true);
    });

    it("reminds about a changed story from before firstEdited was kept", () => {
        expect(needsBackup({ lastEdited: day(1) }, day(1))).toBe(true);
    });

    it("waits a week after the reminder is resolved", () => {
        expect(needsBackup({ firstEdited: day(1), lastEdited: day(3), backupReminderResolved: day(2) }, day(3))).toBe(false);
        expect(needsBackup({ firstEdited: day(1), lastEdited: day(3), backupReminderResolved: day(2) }, day(2) + 7 * DAY)).toBe(true);
    });

    it("waits a month when the browser keeps the site's storage", () => {
        const meta = { firstEdited: day(1), lastEdited: day(3), backupReminderResolved: day(2) };
        expect(needsBackup(meta, day(2) + 7 * DAY, true)).toBe(false);
        expect(needsBackup(meta, day(2) + 30 * DAY, true)).toBe(true);
    });

    it("doesn't remind when nothing has changed since the last download", () => {
        expect(needsBackup({ firstEdited: day(1), lastEdited: day(2), backupReminderResolved: day(3) }, day(30))).toBe(false);
    });
});

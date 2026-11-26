// When to remind the author to download a copy of a story kept in the browser (BackupChip)

const DAY_MS = 24 * 60 * 60 * 1000;

// After the reminder to download a copy is dismissed, or a copy downloaded, how long before it
// can come back. As in Quest Viva, a week: Safari can clear a site's storage after a week without
// a visit. A month when the browser has agreed to keep the site's storage (persisted below).
const BACKUP_REMINDER_AFTER_MS = 7 * DAY_MS;
const PERSISTED_BACKUP_REMINDER_AFTER_MS = 30 * DAY_MS;

export interface BackupMeta {
    // When the story was first and last changed, and when the reminder was last resolved
    firstEdited?: number;
    lastEdited?: number;
    backupReminderResolved?: number;
}

const localDay = (time: number) => new Date(time).toDateString();

// Whether to remind the author to download a copy of a story kept in the browser. Not until it's
// been changed on two different days, so a story made to try something out never gets it (a
// story from before firstEdited was kept has been around long enough). After that, when it's
// been changed since the reminder was last resolved, and that was a week (or a month) ago.
export function needsBackup(meta: BackupMeta, now: number, persisted = false): boolean {
    const { firstEdited, lastEdited, backupReminderResolved } = meta;
    if (lastEdited === undefined) return false;
    if (backupReminderResolved === undefined) return firstEdited === undefined || localDay(firstEdited) !== localDay(lastEdited);
    const after = persisted ? PERSISTED_BACKUP_REMINDER_AFTER_MS : BACKUP_REMINDER_AFTER_MS;
    return lastEdited > backupReminderResolved && now - backupReminderResolved >= after;
}

// Whether the browser keeps this site's storage until the user clears it, rather than clearing it
// when space runs low or (in Safari) after a week without a visit. Asking may show a prompt (in
// Firefox), so it's asked only once a story is worth keeping, when the reminder first shows.
export async function storagePersisted(ask: boolean): Promise<boolean> {
    const storage = globalThis.navigator?.storage;
    try {
        if (!storage?.persisted) return false;
        if (await storage.persisted()) return true;
        return ask && storage.persist ? await storage.persist() : false;
    } catch {
        return false;
    }
}

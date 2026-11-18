// When to remind the author to download a copy of a story kept in the browser (BackupBanner)

// After the reminder to download a copy is dismissed, or a copy downloaded, how long before it
// can come back. As in Quest Viva, a week: Safari can clear a site's storage after a week without a visit.
const BACKUP_REMINDER_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// Whether to remind the author to download a copy of a story kept in the browser: when it's
// been changed since it was created or the reminder was last resolved, and that was a week ago
export function needsBackup(meta: { lastEdited?: number; backupReminderResolved?: number }, now: number): boolean {
    const { lastEdited, backupReminderResolved } = meta;
    if (lastEdited === undefined) return false;
    if (backupReminderResolved === undefined) return true;
    return lastEdited > backupReminderResolved && now - backupReminderResolved >= BACKUP_REMINDER_AFTER_MS;
}

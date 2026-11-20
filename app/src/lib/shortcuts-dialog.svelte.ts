// Whether the Keyboard shortcuts dialog (ShortcutsModal.svelte, in the root layout) is open. Opened
// from the toolbar's ⋯ menu, and from the desktop app's Help menu.
export const shortcutsDialog = $state({ open: false });

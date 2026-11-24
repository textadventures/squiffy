// The icons of the published page's header buttons, for the preview's header when a host asks
// for its buttons (the player at squiffystories.com). The published page has its own copies in
// packager/src/index.template.html, which headerIcons.test.ts checks are the same.

const svg = (paths: string, className?: string) =>
    `<svg${className ? ` class="${className}"` : ""} viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

// Not on the published page: the button that opens the story in the editor, for the player
export const EDIT_ICON = svg("<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"/><path d=\"m15 5 4 4\"/>");
export const BACK_ICON = svg("<path d=\"M19 12H5M12 19l-7-7 7-7\"/>");
export const RESTART_ICON = svg("<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/><path d=\"M3 3v5h5\"/>");
export const MUTE_ICONS =
    svg("<path d=\"M11 5 6 9H2v6h4l5 4V5z\"/><path d=\"M15.5 8.5a5 5 0 0 1 0 7\"/><path d=\"M19 5a10 10 0 0 1 0 14\"/>", "squiffy-icon-sound")
    + svg("<path d=\"M11 5 6 9H2v6h4l5 4V5z\"/><path d=\"m22 9-6 6M16 9l6 6\"/>", "squiffy-icon-muted");
export const THEME_ICONS =
    svg("<path d=\"M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z\"/>", "squiffy-icon-dark")
    + svg("<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4\"/>", "squiffy-icon-light");

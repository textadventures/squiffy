// The panels' layout and colours. The colours come from custom properties, for the app to set on
// the editor from its own theme; the fallbacks are tints of the editor's text colour, so the
// panels suit a light or dark editor with nothing set.
//
//   --ed-search-bg          the bar
//   --ed-search-border      the line under it, and round the fields
//   --ed-search-field-bg    the fields
//   --ed-search-muted       the match count, and icons
//   --ed-search-accent      the focus ring, and a toggle that's on
//   --ed-search-accent-fg   text on the accent colour
//   --ed-search-error       the Find field with no results
import { EditorView } from "@codemirror/view";

const border = "var(--ed-search-border, color-mix(in srgb, currentColor 20%, transparent))";
const muted = "var(--ed-search-muted, color-mix(in srgb, currentColor 65%, transparent))";
const hover = "color-mix(in srgb, currentColor 10%, transparent)";
const accent = "var(--ed-search-accent, #2563eb)";
const error = "var(--ed-search-error, #dc2626)";

export const searchTheme = EditorView.baseTheme({
    // Over @codemirror/view's own colours for a panel
    "& .cm-panels:has(.ed-search)": {
        backgroundColor: "var(--ed-search-bg, transparent)",
        color: "inherit",
    },
    "& .cm-panels-top:has(.ed-search)": {
        borderBottom: `1px solid ${border}`,
    },
    ".ed-search": {
        padding: "6px 8px",
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        lineHeight: "1.4",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
    },
    ".ed-search + .ed-search, .cm-panel + .cm-panel.ed-search": {
        borderTop: `1px solid ${border}`,
    },
    ".ed-search [hidden]": {
        display: "none",
    },
    ".ed-search-row": {
        display: "flex",
        alignItems: "center",
        gap: "4px",
    },
    // In line with the Find field, past the button that shows this row
    ".ed-search-replace, .ed-goto .ed-search-row": {
        paddingLeft: "30px",
    },
    ".ed-search-field": {
        display: "flex",
        alignItems: "center",
        gap: "2px",
        flex: "0 1 22rem",
        minWidth: "8rem",
        height: "28px",
        padding: "0 3px 0 8px",
        border: `1px solid ${border}`,
        borderRadius: "6px",
        backgroundColor: "var(--ed-search-field-bg, transparent)",
    },
    ".ed-goto .ed-search-field": {
        flexBasis: "10rem",
    },
    ".ed-search-field:focus-within": {
        borderColor: accent,
        boxShadow: `0 0 0 1px ${accent}`,
    },
    ".ed-search-field.ed-search-none": {
        borderColor: error,
        boxShadow: `0 0 0 1px ${error}`,
    },
    ".ed-search-input": {
        flex: "1",
        minWidth: "0",
        height: "100%",
        padding: "0",
        border: "none",
        outline: "none",
        boxShadow: "none",
        background: "none",
        color: "inherit",
        font: "inherit",
    },
    ".ed-search-input::placeholder": {
        color: muted,
        opacity: "1",
    },
    ".ed-search button": {
        font: "inherit",
        color: "inherit",
        border: "none",
        background: "none",
        cursor: "pointer",
        borderRadius: "4px",
    },
    ".ed-search button:hover:not(:disabled)": {
        backgroundColor: hover,
    },
    ".ed-search button:focus-visible": {
        outline: `2px solid ${accent}`,
        outlineOffset: "1px",
    },
    ".ed-search button:disabled": {
        opacity: "0.4",
        cursor: "default",
    },
    ".ed-search-icon": {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        width: "26px",
        height: "26px",
        padding: "0",
        color: muted,
    },
    ".ed-search-icon svg": {
        width: "16px",
        height: "16px",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.6",
        strokeLinecap: "round",
        strokeLinejoin: "round",
    },
    ".ed-search-expand svg": {
        transition: "transform 0.1s",
    },
    ".ed-search-expand[aria-expanded=true] svg": {
        transform: "rotate(90deg)",
    },
    ".ed-search-close": {
        marginLeft: "auto",
    },
    ".ed-search-toggle": {
        flex: "none",
        minWidth: "22px",
        height: "22px",
        padding: "0 3px",
        fontSize: "12px",
        color: muted,
    },
    ".ed-search-toggle-word span": {
        borderBottom: "1.5px solid currentColor",
        padding: "0 1px",
    },
    ".ed-search-toggle-regexp": {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    ".ed-search .ed-search-toggle[aria-pressed=true], .ed-search .ed-search-toggle[aria-pressed=true]:hover": {
        backgroundColor: accent,
        color: "var(--ed-search-accent-fg, white)",
    },
    ".ed-search-button": {
        flex: "none",
        height: "28px",
        padding: "0 10px",
        border: `1px solid ${border} !important`,
        whiteSpace: "nowrap",
    },
    ".ed-search-count": {
        flex: "none",
        minWidth: "5.5em",
        padding: "0 6px",
        color: muted,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
    },
    ".ed-search-count:empty": {
        display: "none",
    },
});

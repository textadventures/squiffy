# Styling

A story is a web page styled with CSS. Docs: https://squiffystory.com/styling/

## Where styles go

Put a `.css` file in the story's folder. With `squiffy.json` it's included automatically; without, add `@import style.css`. Only include the properties you change.

## Variables

```css
:root {
    --squiffy-font-family: "Literata", Georgia, serif;
    --squiffy-font-size: 1.25rem;      /* default 1.125rem */
    --squiffy-line-height: 1.5;        /* default 1.6 */
    --squiffy-max-width: 50rem;        /* default 42rem */

    --squiffy-background: light-dark(#fdf6e3, #1e1e2e);
    --squiffy-text: light-dark(#3b3227, #e0e0e0);
    --squiffy-link: light-dark(darkgreen, lightgreen);
    --squiffy-link-hover: light-dark(green, palegreen);
}
```

Other colour variables: `--squiffy-muted` (header buttons, links awaiting valid input), `--squiffy-border` (lines between sections), `--squiffy-error`, `--squiffy-success` (input validation). `--squiffy-side-width` is the side panel width (16rem).

## Light and dark mode

Stories follow the reader's system setting, with a button to switch. Use `light-dark()` so colours work in both. To force one mode (which hides the button): `:root { color-scheme: light; }`. Do that if the CSS sets a colour for only one mode.

## Changing the look for a scene

```squiffy
[[cave]]:
@class dark underground
It's cold, and very dark.
```

```css
body:has(.dark) {
    --squiffy-background: #111;
    --squiffy-text: #ccc;
}
```

`@class` puts classes on the story's element while the section is current; in a passage, they're added until the player leaves the section. Use `body:has(.class)` to change page colours. `{{addclass}}`, `{{removeclass}}`, `{{toggleclass}}` and `(hasclass ...)` change classes mid-section or keep them across sections (helpers.md). Use class names not used elsewhere in the text. Player settings add classes too, such as `setting-textSize-Large` (project.md).

## Useful selectors

| Selector | What |
|---|---|
| `a.squiffy-link`, `a.squiffy-link.disabled` | Links, and links no longer clickable |
| `.squiffy-output-section[data-section="The cellar"]` | One section's output (`data-passage` for passages) |
| `div#squiffy` | The story text |
| `div#squiffy-header` | The sticky header with Back, Save, Restart, light/dark buttons |
| `button#restart`, `button#squiffy-theme` | Restart and light/dark buttons (`display: none` to hide) |
| `aside.squiffy-panels-side`, `section.squiffy-panel` | Side panels |
| `.squiffy-continue` | `{{#animate "continue"}}` links |

Hide the Back or Save buttons with `"backButton": false` / `"saveButton": false` in `squiffy.json`, not CSS.

## Fonts

Put font files in the folder (for example `fonts/`), with `@font-face` rules; `url()` paths are relative to the stylesheet:

```css
@font-face {
    font-family: "My Font";
    src: url("fonts/my-font.woff2") format("woff2");
}
:root { --squiffy-font-family: "My Font", Georgia, serif; }
```

Keep a font's licence file with it.

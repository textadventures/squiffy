// Panels (#14, #443): passages in the master section that are always to hand, rendered again with
// the attributes as they are whenever the story moves on, e.g. the player's stats, inventory or
// a map. A "side" panel is shown beside the story, and a "button" panel is shown in a dialog,
// opened by a button in the header. Neither is part of the story's text, so they don't count as
// moves for Back or saved games. On a screen too narrow for a side panel, it has a button too.
//
//     const panels = createPanels(squiffyApi, {
//         panels: story.panels,
//         buttons: document.getElementById("squiffy-header"),
//         side: document.getElementById("squiffy-container"),
//     });

import { PANEL_ICONS, type Panel, type PanelIcon, type SquiffyApi } from "./types.js";

export interface PanelsOptions {
    // From the story's squiffy.json "panels" (story.panels)
    panels: Panel[];
    // Where the panels' buttons go: at the start of this element, e.g. the page's header
    buttons: HTMLElement;
    // Where side panels go: an <aside class="squiffy-panels-side"> is added at the end of this
    // element, which gets the class squiffy-has-side, so its CSS can make room. Without it,
    // side panels only have their buttons.
    side?: HTMLElement;
    // The dialog's text, for a story in another language: "close". Anything left out is in English.
    strings?: Partial<Record<string, string>>;
    // Where the dialog goes in the page: the end of the body by default
    container?: HTMLElement;
}

export interface Panels {
    // Renders the panels again, e.g. after changing an attribute from outside the story
    refresh: () => void;
    // Opens a panel's dialog, by its passage name
    open: (passage: string) => void;
    // Takes the panels, their buttons and their dialog off the page
    dispose: () => void;
}

const ICON_CLOSE = "<path d=\"M18 6 6 18M6 6l12 12\"/>";

// Lucide icons (ISC licence), as are the page's other buttons
const ICONS: Record<PanelIcon, string> = {
    bag: "<path d=\"M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z\"/><path d=\"M8 10h8\"/><path d=\"M8 18h8\"/><path d=\"M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6\"/><path d=\"M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2\"/>",
    person: "<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\"/><circle cx=\"12\" cy=\"7\" r=\"4\"/>",
    map: "<path d=\"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z\"/><path d=\"M15 5.764v15\"/><path d=\"M9 3.236v15\"/>",
    help: "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3\"/><path d=\"M12 17h.01\"/>",
    info: "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 16v-4\"/><path d=\"M12 8h.01\"/>",
    list: "<path d=\"M3 6h.01M3 12h.01M3 18h.01M8 6h13M8 12h13M8 18h13\"/>",
    book: "<path d=\"M12 7v14\"/><path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\"/>",
    star: "<path d=\"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z\"/>",
    heart: "<path d=\"M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z\"/>",
};

const svg = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

let dialogCount = 0;

export function createPanels(api: SquiffyApi, options: PanelsOptions): Panels {
    const close = typeof options.strings?.close == "string" ? options.strings.close : "Close";
    const id = `squiffy-panel-${++dialogCount}`;
    const cleanups: (() => void)[] = [];

    // The dialog that button panels are shown in, one at a time
    const dialog = document.createElement("dialog");
    dialog.className = "squiffy-panel-dialog";
    dialog.setAttribute("aria-labelledby", `${id}-heading`);
    dialog.innerHTML = `
        <div class="squiffy-panel-dialog-header">
            <h2 id="${id}-heading"></h2>
            <button type="button" class="squiffy-panel-dialog-close">${svg(ICON_CLOSE)}</button>
        </div>
        <div class="squiffy-panel squiffy-panel-dialog-content"></div>`;
    const heading = dialog.querySelector("h2")!;
    const closeButton = dialog.querySelector<HTMLButtonElement>(".squiffy-panel-dialog-close")!;
    closeButton.title = close;
    closeButton.setAttribute("aria-label", close);
    closeButton.addEventListener("click", () => dialog.close());
    const content = dialog.querySelector<HTMLDivElement>(".squiffy-panel-dialog-content")!;
    // Clicking the backdrop closes it too
    dialog.addEventListener("click", event => {
        if (event.target === dialog) dialog.close();
    });
    (options.container ?? document.body).appendChild(dialog);
    cleanups.push(() => dialog.remove());
    // The panel the dialog is showing
    let shown: Panel | null = null;

    const panels = options.panels.filter(panel => panel && typeof panel.passage == "string");

    // The side panels, beside the story
    const sidePanels = options.side ? panels.filter(panel => panel.position == "side") : [];
    const sideSections = new Map<Panel, HTMLElement>();
    let aside: HTMLElement | null = null;
    if (sidePanels.length && options.side) {
        aside = document.createElement("aside");
        aside.className = "squiffy-panels-side";
        for (const panel of sidePanels) {
            const section = document.createElement("section");
            section.className = "squiffy-panel";
            section.dataset.passage = panel.passage;
            section.setAttribute("aria-label", panel.label || panel.passage);
            aside.appendChild(section);
            sideSections.set(panel, section);
        }
        const side = options.side;
        side.appendChild(aside);
        side.classList.add("squiffy-has-side");
        cleanups.push(() => {
            aside!.remove();
            side.classList.remove("squiffy-has-side");
        });
    }

    // A button for each panel, in the order they're listed, before anything already in the header.
    // A side panel's button is only shown on screens too narrow for the panel.
    const first = options.buttons.firstChild;
    for (const panel of panels) {
        const label = panel.label || panel.passage;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "squiffy-header-button squiffy-panel-button";
        if (panel.position == "side" && sideSections.has(panel)) button.classList.add("squiffy-panel-side-button");
        button.dataset.passage = panel.passage;
        button.setAttribute("aria-haspopup", "dialog");
        const icon = panel.icon && (PANEL_ICONS as readonly string[]).includes(panel.icon) ? ICONS[panel.icon] : null;
        if (icon) {
            button.innerHTML = svg(icon);
            button.title = label;
            button.setAttribute("aria-label", label);
        }
        else {
            button.classList.add("squiffy-panel-text-button");
            button.textContent = label;
        }
        button.addEventListener("click", () => open(panel));
        options.buttons.insertBefore(button, first);
        cleanups.push(() => button.remove());
    }

    function open(panel: Panel) {
        shown = panel;
        heading.textContent = panel.label || panel.passage;
        content.innerHTML = api.renderPassage(panel.passage);
        if (!dialog.open) dialog.showModal();
    }

    function refresh() {
        for (const [panel, section] of sideSections) {
            section.innerHTML = api.renderPassage(panel.passage);
            // Text that comes out empty, e.g. from an {{#if}}, hides the panel
            section.hidden = !section.textContent?.trim() && !section.querySelector("img, svg, video, canvas, iframe");
        }
        if (aside) aside.hidden = [...sideSections.values()].every(section => section.hidden);
        if (dialog.open && shown) content.innerHTML = api.renderPassage(shown.passage);
    }

    // Rendered again once whatever changed has finished changing, rather than after every attribute
    let queued = false;
    const queueRefresh = () => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
            queued = false;
            if (!disposed) refresh();
        });
    };
    for (const event of ["set", "navigated", "storyUpdated"] as const) {
        cleanups.push(api.on(event, queueRefresh));
    }
    dialog.addEventListener("close", () => { shown = null; });

    let disposed = false;
    refresh();

    return {
        refresh,
        open(passage: string) {
            const panel = panels.find(p => p.passage == passage);
            if (panel) open(panel);
        },
        dispose() {
            disposed = true;
            if (dialog.open) dialog.close();
            for (const cleanup of cleanups.splice(0)) cleanup();
        },
    };
}

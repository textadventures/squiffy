// Small helpers for building the panels' DOM.

type Attrs = Record<string, string | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
        if (value === undefined || value === false) continue;
        node.setAttribute(name, value === true ? "" : value);
    }
    node.append(...children);
    return node;
}

// A stroked 16x16 icon, in the text colour
export function icon(path: string): SVGSVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", path);
    svg.append(p);
    return svg;
}

export const ICONS = {
    up: "M8 12.5v-9M4 7.5l4-4 4 4",
    down: "M8 3.5v9M4 8.5l4 4 4-4",
    close: "M4 4l8 8M12 4l-8 8",
    chevron: "M6 3.5l4.5 4.5L6 12.5",
};

export function iconButton(name: string, label: string, path: string, onClick: () => void): HTMLButtonElement {
    const button = el("button", { type: "button", name, class: "ed-search-icon", title: label, "aria-label": label }, [icon(path)]);
    button.addEventListener("click", onClick);
    return button;
}

export function isMac(): boolean {
    return typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform);
}

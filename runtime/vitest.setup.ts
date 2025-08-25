import cssEscape from "css.escape";

declare global {
    interface CSS {
        escape(value: string): string;
    }
}

const g = globalThis as any;

if (!g.CSS) g.CSS = {};
if (typeof g.CSS.escape !== "function") {
    g.CSS.escape = cssEscape;
}

export {};

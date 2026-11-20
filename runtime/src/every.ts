// {{#every 1000}}...{{/every}} (#451): text shown again and again, every so often, while the
// player is in the section. Each time, its text is worked out again and replaces what it showed
// before (or, with append=true, is added after it), until a {{stop}} inside it, times= ticks, or
// the player moving on to another section.
//
// The text is kept in the page, so a saved game, going back and the editor's preview can start
// it again: before the text is compiled, captureEveryBodies() copies each {{#every}}'s text into a
// hidden __body= parameter, which the helper puts in the element it writes.

import { findTagEnd } from "./infixExpressions.js";

const everyTag = /(\\*)\{\{~?\s*(?:(#every)(?=[\s}~])|(\/every)\s*~?\}\})/g;

// Adds __body="..." to each {{#every}}, with the text between it and its {{/every}}, encoded so
// that it can't end the string or the tag
export function captureEveryBodies(text: string): string {
    if (!text.includes("#every")) return text;
    const insertions: { at: number; text: string }[] = [];
    const open: { tagEnd: number; bodyStart: number }[] = [];
    everyTag.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = everyTag.exec(text)) !== null) {
        // An odd number of backslashes escapes the mustache
        if (match[1].length % 2 === 1) continue;
        if (match[2]) {
            const tagEnd = findTagEnd(text, match.index + match[0].length);
            if (tagEnd === -1) break;
            const bodyStart = text.indexOf("}}", tagEnd) + 2;
            // With no delay, it's left for the helper to report, as __body= would be the delay
            const hasDelay = text.slice(match.index + match[0].length, tagEnd).trim() !== "";
            open.push({ tagEnd: hasDelay ? tagEnd : -1, bodyStart });
            everyTag.lastIndex = bodyStart;
        } else {
            const start = open.pop();
            if (!start) continue;
            if (start.tagEnd === -1) continue;
            const body = text.slice(start.bodyStart, match.index + match[1].length);
            insertions.push({ at: start.tagEnd, text: ` __body="${encodeURIComponent(body)}"` });
        }
    }
    insertions.sort((a, b) => b.at - a.at);
    for (const { at, text: insert } of insertions) {
        text = text.slice(0, at) + insert + text.slice(at);
    }
    return text;
}

export const everySelector = ".squiffy-every:not([data-every-stopped])";

// A tick's timer function is marked, so that the CLI's --play can tell a story that's only
// repeating some text from one that's still moving on by itself
export const EVERY_TICK = "squiffyEvery";

// The timers for the {{#every}}s in the current section. sync() starts a timer for each one that
// hasn't got one, and stops those that aren't there any more.
export class EveryTimers {
    private timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

    // tick: shows the text again. It returns false if it can't yet, e.g. while a transition is
    // running, so it's tried again a little later.
    constructor(private getRoot: () => HTMLElement | undefined, private tick: (el: HTMLElement) => boolean) {}

    sync() {
        const root = this.getRoot();
        const active = new Set(root?.isConnected ? root.querySelectorAll<HTMLElement>(everySelector) : []);
        for (const [el, timer] of this.timers) {
            if (!active.has(el)) {
                clearTimeout(timer);
                this.timers.delete(el);
            }
        }
        for (const el of active) {
            if (!this.timers.has(el)) this.schedule(el, Number(el.getAttribute("data-every-delay")) || 0);
        }
    }

    stopAll() {
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
    }

    private schedule(el: HTMLElement, ms: number) {
        const fn = () => {
            this.timers.delete(el);
            if (!this.tick(el)) {
                this.schedule(el, 50);
                return;
            }
            this.sync();
        };
        (fn as unknown as Record<string, boolean>)[EVERY_TICK] = true;
        this.timers.set(el, setTimeout(fn, ms));
    }
}

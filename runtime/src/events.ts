/* eslint-disable @typescript-eslint/no-unsafe-function-type */

export type SquiffyEventMap = {
    linkClick: { linkType: string }; // a story link was clicked
    set: { attribute: string, value: any }; // an attribute was set
    canGoBackChanged: { canGoBack: boolean }; // whether the "back" button should be enabled
    navigated: { section: string, passage?: string }; // a section or passage was shown, or Back went to one
    sound: Record<string, never>; // music or a sound started playing (#444), even if it's muted
    storyUpdated: Record<string, never>; // update() changed the story, e.g. after an edit in the editor
    // A {{restart}} link was clicked (#452). With a handler, the page does the restarting, asking
    // first if confirm is true. Without one, the runtime asks in its own dialog.
    restartRequested: { confirm: boolean };
    // A {{saves}} link was clicked (#452). With a handler, the page opens its Saved games dialog.
    // Without one, the runtime opens one of its own.
    savesRequested: Record<string, never>;
};

export type SquiffyEventHandler<E extends keyof SquiffyEventMap> =
    (payload: SquiffyEventMap[E]) => void;

export class Emitter<Events extends Record<string, any>> {
    private listeners = new Map<keyof Events, Set<Function>>();

    on<E extends keyof Events>(event: E, handler: (p: Events[E]) => void) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(handler);
        return () => this.off(event, handler);
    }

    off<E extends keyof Events>(event: E, handler: (p: Events[E]) => void) {
        this.listeners.get(event)?.delete(handler);
    }

    once<E extends keyof Events>(event: E, handler: (p: Events[E]) => void) {
        const off = this.on(event, (payload) => {
            off();
            handler(payload);
        });
        return off;
    }

    // Whether anything is listening for the event
    has<E extends keyof Events>(event: E) {
        return (this.listeners.get(event)?.size ?? 0) > 0;
    }

    emit<E extends keyof Events>(event: E, payload: Events[E]) {
        this.listeners.get(event)?.forEach(h => {
            try { (h as any)(payload); } catch (err) {
                // Swallow so a bad handler doesn't break the game; optionally log.
                console.error(`[Squiffy] handler for "${String(event)}" failed`, err);
            }
        });
    }
}

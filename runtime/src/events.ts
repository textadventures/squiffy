export type SquiffyEventMap = {
    linkClick: { linkType: string }; // a story link was clicked
    set: { attribute: string, value: any }; // an attribute was set
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

    emit<E extends keyof Events>(event: E, payload: Events[E]) {
        // Fire handlers asynchronously so the runtime isn't blocked by user code.
        queueMicrotask(() => {
            this.listeners.get(event)?.forEach(h => {
                try { (h as any)(payload); } catch (err) {
                    // Swallow so a bad handler doesn't break the game; optionally log.
                    console.error(`[Squiffy] handler for "${String(event)}" failed`, err);
                }
            });
        });
    }
}

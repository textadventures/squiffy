// A small request/response protocol over postMessage, used between the app and the language
// service's Web Worker. Both ends can call each other: the app calls the language service, and
// the worker calls back to read project files, which only the app's thread can reach (the
// Electron bridge, for one, only exists on the window).

type Message =
    | { rpc: "call"; id: number; method: string; args: unknown[] }
    | { rpc: "result"; id: number; result: unknown }
    | { rpc: "error"; id: number; message: string };

export interface Port {
    postMessage(message: unknown): void;
    addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

export type Handlers = Record<string, (...args: any[]) => unknown>;

export interface Endpoint<Remote extends Handlers> {
    call<K extends keyof Remote & string>(method: K, ...args: Parameters<Remote[K]>): Promise<Awaited<ReturnType<Remote[K]>>>;
}

function isMessage(data: unknown): data is Message {
    return typeof data === "object" && data !== null && "rpc" in data && "id" in data;
}

export function connect<Remote extends Handlers>(port: Port, local: Handlers): Endpoint<Remote> {
    let nextId = 0;
    const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

    port.addEventListener("message", async event => {
        const message = event.data;
        if (!isMessage(message)) return;
        if (message.rpc === "call") {
            const handler = local[message.method];
            try {
                if (!handler) throw new Error(`Unknown method ${message.method}`);
                const result = await handler(...message.args);
                port.postMessage({ rpc: "result", id: message.id, result } satisfies Message);
            } catch (err) {
                const text = err instanceof Error ? err.message : String(err);
                port.postMessage({ rpc: "error", id: message.id, message: text } satisfies Message);
            }
            return;
        }
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.rpc === "result") request.resolve(message.result);
        else request.reject(new Error(message.message));
    });

    return {
        call(method, ...args) {
            const id = ++nextId;
            return new Promise((resolve, reject) => {
                pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
                port.postMessage({ rpc: "call", id, method, args } satisfies Message);
            });
        },
    };
}

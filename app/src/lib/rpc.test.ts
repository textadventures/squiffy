import { describe, expect, test } from "vitest";
import { MessageChannel, type MessagePort } from "node:worker_threads";
import { connect, type Handlers, type Port } from "./rpc.js";

// Node's MessagePort delivers { data } to addEventListener listeners, like the browser's
function port(p: MessagePort): Port {
    return {
        postMessage: m => p.postMessage(m),
        addEventListener: (_type, listener) => p.on("message", data => listener({ data } as MessageEvent)),
    };
}

describe("rpc", () => {
    test("calls both ways, and passes errors back", async () => {
        const { port1, port2 } = new MessageChannel();
        const files = { "a.squiffy": "Hello" } as Record<string, string>;

        interface Host extends Handlers { readText(path: string): string }
        interface Service extends Handlers { length(path: string): Promise<number> }

        const host = connect<Service>(port(port1), {
            readText: (path: string) => {
                if (!(path in files)) throw new Error(`No file ${path}`);
                return files[path];
            },
        });
        const service = connect<Host>(port(port2), {
            length: async (path: string) => (await service.call("readText", path)).length,
        });

        expect(await host.call("length", "a.squiffy")).toBe(5);
        await expect(host.call("length", "b.squiffy")).rejects.toThrow("No file b.squiffy");
        port1.close();
    });
});

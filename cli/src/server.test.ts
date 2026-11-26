import { afterEach, beforeEach, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { createServer, serve } from "./server.js";

let dir: string;
let server: Server;
let url: string;

beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "squiffy-server-"));
    fs.writeFileSync(path.join(dir, "index.html"), "<html>published</html>");
    fs.writeFileSync(path.join(dir, "story.js"), "var story = 'published';");
    fs.writeFileSync(path.join(dir, "squiffy.css"), "body {}");
    server = createServer(dir, { "index.html": "<html>testing</html>", "story.js": "var story = 'testing';" });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
});

test("the story's page and script are the ones for testing, however the page is asked for", async () => {
    for (const address of ["/", "/index.html", "/?start=kitchen&set=score=5"]) {
        const response = await fetch(url + address);
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(await response.text()).toBe("<html>testing</html>");
    }
    const script = await fetch(url + "/story.js");
    expect(script.headers.get("content-type")).toContain("text/javascript");
    expect(await script.text()).toBe("var story = 'testing';");
});

test("the files on disk, and the story's other files, are as they were built", async () => {
    await fetch(url + "/");
    expect(fs.readFileSync(path.join(dir, "index.html"), "utf8")).toBe("<html>published</html>");
    expect(fs.readFileSync(path.join(dir, "story.js"), "utf8")).toBe("var story = 'published';");
    expect(await (await fetch(url + "/squiffy.css")).text()).toBe("body {}");
    expect((await fetch(url + "/missing.js")).status).toBe(404);
});

test("serve listens on this computer only, unless it's asked to listen on another address", async () => {
    const log = console.log;
    console.log = () => {};
    try {
        for (const [host, expected] of [[undefined, "127.0.0.1"], ["0.0.0.0", "0.0.0.0"]] as const) {
            const served = serve(dir, 0, {}, host);
            await new Promise<void>(resolve => served.once("listening", resolve));
            expect((served.address() as AddressInfo).address).toBe(expected);
            await new Promise(resolve => served.close(resolve));
        }
    } finally {
        console.log = log;
    }
});

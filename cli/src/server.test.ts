import { afterEach, beforeEach, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { createServer, withStartAnywhere } from "./server.js";

let dir: string;
let server: Server;
let url: string;

beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "squiffy-server-"));
    fs.writeFileSync(path.join(dir, "index.html"), "<!DOCTYPE html>\n<html>\n<head>\n    <title>Story</title>\n</head>\n<body></body>\n</html>");
    fs.writeFileSync(path.join(dir, "story.js"), "var story = {};");
    server = createServer(dir);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
});

test("the page is served with starting anywhere turned on, before its other scripts", () => {
    expect(withStartAnywhere("<html>\n<head>\n    <script src=\"story.js\"></script>\n</head>\n</html>")).toBe(
        "<html>\n<head>\n    <script>window.squiffyStartAnywhere = true;</script>\n    <script src=\"story.js\"></script>\n</head>\n</html>");
});

test("the server turns it on for the story's page, however it's asked for", async () => {
    for (const address of ["/", "/index.html", "/?start=kitchen&set=score=5"]) {
        const response = await fetch(url + address);
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(await response.text()).toContain("window.squiffyStartAnywhere = true;");
    }
});

test("the file on disk, and the story's other files, are as they were built", async () => {
    await fetch(url + "/");
    expect(fs.readFileSync(path.join(dir, "index.html"), "utf8")).not.toContain("squiffyStartAnywhere");
    expect(await (await fetch(url + "/story.js")).text()).toBe("var story = {};");
    expect((await fetch(url + "/missing.js")).status).toBe(404);
});

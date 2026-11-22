import finalhandler from "finalhandler";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import serveStatic from "serve-static";

// Turns on starting at any section in a story's page, for the author testing it: "?start=section"
// on the address, and the Start at menu. Only the page as it's served is changed, not the file,
// so the story that's published doesn't have them (unless its squiffy.json asks for them).
export const withStartAnywhere = (html: string) =>
    html.replace(/<head>/i, match => match + "\n    <script>window.squiffyStartAnywhere = true;</script>");

export function createServer(dir: string) {
    const serve = serveStatic(dir, { index: ["index.html"] });
    const indexFile = path.join(dir, "index.html");

    return http.createServer(function (req: any, res: any) {
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        if ((req.method == "GET" || req.method == "HEAD") && (pathname == "/" || pathname == "/index.html") && fs.existsSync(indexFile)) {
            const html = Buffer.from(withStartAnywhere(fs.readFileSync(indexFile, "utf8")));
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": html.length, "Cache-Control": "no-cache" });
            res.end(req.method == "HEAD" ? undefined : html);
            return;
        }
        const done = finalhandler(req, res);
        serve(req, res, done);
    });
}

export const serve = (directory: string, port: number) => {
    createServer(directory).listen(port);
    console.log("Started http://localhost:" + port + "/");
    console.log("To start at a section, use the flag button on the page, or add ?start=section to the address.");
};

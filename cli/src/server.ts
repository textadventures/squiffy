import finalhandler from "finalhandler";
import * as http from "http";
import serveStatic from "serve-static";

const TYPES: Record<string, string> = { html: "text/html", js: "text/javascript", css: "text/css" };

// Serves a built story's folder. The files in testingFiles (by name, at the top of the folder) are
// sent in place of the ones on disk: the story's page as its author tests it, which can start at
// any section and has its @test sections, where the files on disk are the story as it'll be
// published, without either.
export function createServer(dir: string, testingFiles: Record<string, string> = {}) {
    const serve = serveStatic(dir, { index: ["index.html"] });

    return http.createServer(function (req: any, res: any) {
        let pathname = "";
        try {
            pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
        }
        catch {
            // Left to serve-static, which answers a bad address
        }
        const name = pathname == "/" ? "index.html" : pathname.slice(1);
        if ((req.method == "GET" || req.method == "HEAD") && Object.prototype.hasOwnProperty.call(testingFiles, name)) {
            const body = Buffer.from(testingFiles[name]);
            const type = TYPES[name.split(".").pop() ?? ""] ?? "text/plain";
            res.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Content-Length": body.length, "Cache-Control": "no-cache" });
            res.end(req.method == "HEAD" ? undefined : body);
            return;
        }
        const done = finalhandler(req, res);
        serve(req, res, done);
    });
}

export const serve = (directory: string, port: number, testingFiles: Record<string, string> = {}) => {
    createServer(directory, testingFiles).listen(port);
    console.log("Started http://localhost:" + port + "/");
    console.log("To start at a section, use the flag button on the page, or add ?start=section to the address.");
};

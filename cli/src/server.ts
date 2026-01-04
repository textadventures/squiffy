import finalhandler from "finalhandler";
import * as http from "http";
import serveStatic from "serve-static";

function startServer(dir: string, port: number) {    
    const serve = serveStatic(dir, { index: ["index.html"] });

    const server = http.createServer(function (req: any, res: any) {
        const done = finalhandler(req, res);
        serve(req, res, done);
    });

    server.listen(port);
}

export const serve = (directory: string, port: number) => {
    startServer(directory, port);
    console.log("Started http://localhost:" + port + "/");
};
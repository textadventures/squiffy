import finalhandler from 'finalhandler';
import * as http from 'http';
import serveStatic from 'serve-static';

function startServer(dir: string, port: number) {    
    var serve = serveStatic(dir, { index: ['index.html'] });

    var server = http.createServer(function (req: any, res: any) {
        var done = finalhandler(req, res);
        serve(req, res, done);
    });

    server.listen(port);
}

export const serve = (directory: string, port: number) => {
    startServer(directory, port);
    console.log('Started http://localhost:' + port + '/');
}
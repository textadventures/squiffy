/* jshint quotmark: single */

var http = require('http');
var qs = require('querystring');
var compiler = require('./compiler.js');

var port = process.env.PORT || 1337;

http.createServer(function(request, response) {
	if (request.method == 'POST') {
		var body = '';
		request.on('data', function (data) {
			body += data;

			// Too much POST data, kill the connection!
			if (body.length > 1e6)
				request.connection.destroy();
		});
		request.on('end', function () {
			try {
				var result = compiler.getJs(body, __dirname);
				response.writeHead(200, {
					'Content-Type': 'application/javascript',
					'Access-Control-Allow-Origin': '*'
				});
				response.end(result);
			}
			catch(err) {
				response.writeHead(200, {
					'Content-Type': 'text/html',
					'Access-Control-Allow-Origin': '*'
				});
				response.end('Failed ' + err);
			}
		});
	}
	else {
		response.writeHead(200, { 'Content-Type': 'text/html' });   
		response.end('Running');
	}
}).listen(port);
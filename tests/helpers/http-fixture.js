const http = require('node:http');

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.once('error', reject);
  });
}

function createFixtureServer(handler) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const body = await readRequestBody(request);
      const result = await handler(url, request, body);

      if (!result) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('not found');
        return;
      }

      const status = result.status || 200;
      const headers = result.headers || { 'content-type': 'application/json; charset=utf-8' };
      const responseBody =
        typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
      response.writeHead(status, headers);
      response.end(responseBody);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: { message: error.message } }));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise(closeResolve => server.close(closeResolve))
      });
    });
  });
}

module.exports = { createFixtureServer };

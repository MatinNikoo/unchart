// A tiny static file server for the repo, used by the scripts that drive Chromium. Returns the port.
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serve() {
  const server = http.createServer((q, s) => {
    const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream' }); fs.createReadStream(p).pipe(s);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ port: server.address().port, close: () => server.close() })));
}
module.exports = { serve };

// Servidor estático mínimo con cabeceras COOP/COEP (necesarias para
// SharedArrayBuffer / pthreads del motor WASM). Uso: node serve_coop.js <dir> <puerto>
const http = require('http');
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || '.';
const port = parseInt(process.argv[3] || '8099', 10);
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm',
  '.data': 'application/octet-stream', '.json': 'application/json',
};

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(dir, rel);
  fs.readFile(file, (err, buf) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (err) { res.statusCode = 404; res.end('404'); return; }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(buf);
  });
}).listen(port, () => console.log('COOP/COEP server en http://localhost:' + port));

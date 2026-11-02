// Servidor estático del mezclador PRO (web/pro) para el Preview en Coolify.
// Emite las cabeceras de aislamiento de origen (COOP/COEP) que el motor WASM necesita
// para usar SharedArrayBuffer, y el MIME correcto para .wasm. Sin dependencias.
//   WEB_ROOT  raíz del sitio (default /app/web)   PORT  puerto (default 80)
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.WEB_ROOT || '/app/web');
const PORT = parseInt(process.env.PORT || '80', 10);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.map': 'application/json',
};

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') return send(res, 200, 'ok\n', 'text/plain');
  const rel = url.replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden');  // evita traversal
  fs.readFile(file, (err, buf) => {
    if (err) {  // fallback a index.html
      fs.readFile(path.join(ROOT, 'index.html'), (e2, idx) => {
        if (e2) return send(res, 404, 'not found');
        send(res, 200, idx, TYPES['.html']);
      });
      return;
    }
    send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream');
  });
}).listen(PORT, () => console.log(`AUDIT SOUND PRO en :${PORT} (root=${ROOT})`));

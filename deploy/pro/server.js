// Servidor estático del mezclador PRO (web/pro) para el Preview en Coolify.
// Emite las cabeceras de aislamiento de origen (COOP/COEP) que el motor WASM necesita
// para usar SharedArrayBuffer, y el MIME correcto para .wasm. Sin dependencias.
//   WEB_ROOT  raíz del sitio (default /app/web)   PORT  puerto (default 80)
//
// Además hace de PROXY de música libre (Jamendo, Creative Commons): el navegador
// habla con este servidor (mismo origen), y este servidor consulta la fuente y
// re-sirve el audio. Así no hay problemas de CORS/COEP y la clave de API vive solo
// aquí (variable de entorno, nunca en el repo).
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.WEB_ROOT || '/app/web');
const PORT = parseInt(process.env.PORT || '80', 10);

// --- Música libre (Jamendo) ---
const OM = {
  clientId: process.env.JAMENDO_CLIENT_ID || '',
  apiBase: (process.env.JAMENDO_API_BASE || 'https://api.jamendo.com/v3.0').replace(/\/+$/, ''),
  // Lista blanca de hosts de audio permitidos para el proxy (evita proxy abierto).
  audioHosts: (process.env.OPENMUSIC_AUDIO_HOSTS ||
    'prod-1.storage.jamendo.com,prod-2.storage.jamendo.com,storage.jamendo.com,mp3l.jamendo.com,mp3d.jamendo.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  maxBytes: parseInt(process.env.OPENMUSIC_MAX_BYTES || String(60 * 1024 * 1024), 10), // 60 MB tope
};

// config.js para la landing/mezclador: URL de streaming y bandera de música libre.
try {
  const listen = process.env.LISTEN_URL || '';
  let body = listen ? `window.AUDIT_SOUND_LISTEN=${JSON.stringify(listen)};\n` : '/* sin LISTEN_URL */\n';
  body += `window.AUDIT_SOUND_OPENMUSIC=${OM.clientId ? 'true' : 'false'};\n`;
  fs.writeFileSync(path.join(ROOT, 'config.js'), body);
  if (listen) console.log('config.js: LISTEN_URL=' + listen);
  console.log('config.js: música libre ' + (OM.clientId ? 'ACTIVADA (Jamendo)' : 'desactivada (sin JAMENDO_CLIENT_ID)'));
} catch (e) { /* no crítico */ }

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.map': 'application/json',
};

function headers(type) {
  return {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': 'no-cache',
  };
}
function send(res, code, body, type) { res.writeHead(code, headers(type)); res.end(body); }
function sendJson(res, code, obj) { res.writeHead(code, headers('application/json')); res.end(JSON.stringify(obj)); }

// --- Proxy: búsqueda en Jamendo (devuelve una lista normalizada) ---
async function handleSearch(u, res) {
  if (!OM.clientId) return sendJson(res, 503, { error: 'Música libre no configurada (falta JAMENDO_CLIENT_ID en el servidor).' });
  const q = u.searchParams.get('q') || '';
  const limit = Math.min(50, Math.max(1, parseInt(u.searchParams.get('limit') || '30', 10)));
  const api = `${OM.apiBase}/tracks/?client_id=${encodeURIComponent(OM.clientId)}&format=json&limit=${limit}` +
    `&search=${encodeURIComponent(q)}&audioformat=mp31&include=licenses&order=popularity_total`;
  let r;
  try { r = await fetch(api); } catch (e) { return sendJson(res, 502, { error: 'no se pudo consultar la fuente: ' + (e.message || e) }); }
  if (!r.ok) return sendJson(res, 502, { error: 'la fuente respondió HTTP ' + r.status });
  let j; try { j = await r.json(); } catch (e) { return sendJson(res, 502, { error: 'respuesta no válida de la fuente' }); }
  const results = (j.results || []).map((t) => ({
    id: String(t.id), title: t.name || '', artist: t.artist_name || '',
    duration: t.duration || 0, audio: t.audio || t.audiodownload || '',
    license: t.license_ccurl || '', album: t.album_name || '',
  })).filter((t) => t.audio);
  sendJson(res, 200, { results });
}

// --- Proxy: audio (solo hosts en lista blanca; tope de tamaño) ---
async function handleAudio(u, res) {
  const raw = u.searchParams.get('url') || '';
  let target;
  try { target = new URL(raw); } catch (e) { return sendJson(res, 400, { error: 'url inválida' }); }
  if (!/^https?:$/.test(target.protocol)) return sendJson(res, 400, { error: 'protocolo no permitido' });
  if (!OM.audioHosts.includes(target.host.toLowerCase())) return sendJson(res, 403, { error: 'host de audio no permitido: ' + target.host });
  let r;
  try { r = await fetch(target.href); } catch (e) { return sendJson(res, 502, { error: 'no se pudo descargar: ' + (e.message || e) }); }
  if (!r.ok) return sendJson(res, 502, { error: 'la fuente respondió HTTP ' + r.status });
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > OM.maxBytes) return sendJson(res, 413, { error: 'archivo demasiado grande' });
  const ct = r.headers.get('content-type') || 'audio/mpeg';
  res.writeHead(200, headers(ct.includes('audio') ? ct : 'audio/mpeg'));
  res.end(buf);
}

http.createServer((req, res) => {
  const u = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(u.pathname);
  if (pathname === '/healthz') return send(res, 200, 'ok\n', 'text/plain');
  if (pathname === '/api/openmusic/search') { handleSearch(u, res).catch((e) => sendJson(res, 500, { error: String(e && e.message || e) })); return; }
  if (pathname === '/api/openmusic/audio') { handleAudio(u, res).catch((e) => sendJson(res, 500, { error: String(e && e.message || e) })); return; }

  const rel = pathname.replace(/^\/+/, '') || 'index.html';
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

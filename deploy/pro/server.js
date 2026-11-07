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

// --- Internet Archive (API abierta, sin clave) ---
const IA = {
  apiBase: (process.env.ARCHIVE_API_BASE || 'https://archive.org').replace(/\/+$/, ''),
  enabled: process.env.ARCHIVE_ENABLED !== 'false',  // activado por defecto (no necesita clave)
  maxBytes: parseInt(process.env.ARCHIVE_MAX_BYTES || String(80 * 1024 * 1024), 10), // 80 MB tope
};
// Host de descarga permitido: archive.org y sus nodos *.archive.org (o el host del apiBase,
// útil para pruebas con un servidor simulado).
function iaHostOk(host) {
  host = (host || '').toLowerCase();
  if (host === 'archive.org' || host.endsWith('.archive.org')) return true;
  try { return host === new URL(IA.apiBase).host.toLowerCase(); } catch (e) { return false; }
}

// --- Proxy del agente DJ (Fase 5) ---
// El navegador habla con /api/v1/dj-agent/* en ESTE origen y aquí se reenvía al servicio
// dj-agent (DJ_AGENT_URL, p. ej. http://dj-agent:8790 en la red interna). Así no hay CORS,
// el agente no se expone a internet y el WebSocket de eventos pasa por el mismo camino.
// Sin DJ_AGENT_URL el proxy responde 503 y la interfaz sigue en modo demostración.
const AGENT = {
  url: (process.env.DJ_AGENT_URL || '').replace(/\/+$/, ''),
  maxBody: parseInt(process.env.DJ_AGENT_MAX_BODY || String(64 * 1024), 10),
  timeoutMs: parseInt(process.env.DJ_AGENT_TIMEOUT_MS || '30000', 10),
};
const AGENT_PREFIX = '/api/v1/dj-agent/';
// Solo se reenvían estas cabeceras (nada de cookies del sitio ni cabeceras de salto).
const AGENT_FWD = ['authorization', 'content-type', 'accept', 'idempotency-key', 'x-correlation-id'];

function agentTarget() {
  try { return AGENT.url ? new URL(AGENT.url) : null; } catch (e) { return null; }
}

function proxyAgent(req, res, pathWithQuery) {
  const target = agentTarget();
  if (!target) return sendJson(res, 503, { error: { code: 'agent_not_configured',
    message: 'El agente DJ no está configurado en este servidor (falta DJ_AGENT_URL).' } });
  const hdrs = {};
  for (const h of AGENT_FWD) if (req.headers[h]) hdrs[h] = req.headers[h];
  let size = 0;
  const up = http.request({ protocol: target.protocol, hostname: target.hostname, port: target.port,
    method: req.method, path: pathWithQuery, headers: hdrs, timeout: AGENT.timeoutMs }, (r) => {
    const out = headers(r.headers['content-type'] || 'application/json');
    if (r.headers['x-correlation-id']) out['X-Correlation-Id'] = r.headers['x-correlation-id'];
    res.writeHead(r.statusCode || 502, out);
    r.pipe(res);
  });
  up.on('timeout', () => up.destroy(new Error('timeout')));
  up.on('error', () => { if (!res.headersSent) sendJson(res, 502, { error: { code: 'agent_unreachable',
    message: 'El agente DJ no responde. El audio no depende de él: AutoMix sigue sonando.' } }); });
  req.on('data', (c) => {
    size += c.length;
    if (size > AGENT.maxBody) { up.destroy(); if (!res.headersSent) sendJson(res, 413, { error: { code: 'body_too_large', message: 'Petición demasiado grande' } }); req.destroy(); }
  });
  req.pipe(up);
}

function proxyAgentUpgrade(req, socket, head, pathWithQuery) {
  const target = agentTarget();
  if (!target) { socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return; }
  const up = http.request({ protocol: target.protocol, hostname: target.hostname, port: target.port,
    method: 'GET', path: pathWithQuery, headers: {
      connection: 'Upgrade', upgrade: 'websocket',
      'sec-websocket-key': req.headers['sec-websocket-key'] || '',
      'sec-websocket-version': req.headers['sec-websocket-version'] || '13',
      ...(req.headers['sec-websocket-protocol'] ? { 'sec-websocket-protocol': req.headers['sec-websocket-protocol'] } : {}),
    } });
  up.on('upgrade', (r, upSocket, upHead) => {
    let line = `HTTP/1.1 101 Switching Protocols\r\n`;
    for (const [k, v] of Object.entries(r.headers)) line += `${k}: ${v}\r\n`;
    socket.write(line + '\r\n');
    if (upHead && upHead.length) socket.write(upHead);
    if (head && head.length) upSocket.write(head);
    upSocket.pipe(socket); socket.pipe(upSocket);
    const close = () => { upSocket.destroy(); socket.destroy(); };
    upSocket.on('error', close); socket.on('error', close); upSocket.on('close', close); socket.on('close', close);
  });
  up.on('response', (r) => { socket.end(`HTTP/1.1 ${r.statusCode} Upstream\r\n\r\n`); });
  up.on('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
  up.end();
}

// config.js para la landing/mezclador: URL de streaming y banderas de fuentes libres.
try {
  const listen = process.env.LISTEN_URL || '';
  let body = listen ? `window.AUDIT_SOUND_LISTEN=${JSON.stringify(listen)};\n` : '/* sin LISTEN_URL */\n';
  body += `window.AUDIT_SOUND_OPENMUSIC=${OM.clientId ? 'true' : 'false'};\n`;
  body += `window.AUDIT_SOUND_ARCHIVE=${IA.enabled ? 'true' : 'false'};\n`;
  // Enlace al Command Center (AuditBrain): el login de la consola reutiliza las
  // Cuentas de Aplicaciones AUDIT-IA. AUDIT_SOUND_CC_API = base del backend
  // INCLUYENDO el prefijo de la API: "https://api.audit-ia.ec/api/v1". Los paths
  // opcionales sobreescriben los default (/apps/auth/login, /apps/auth/me).
  // Recuerda añadir el origen de AUDIT SOUND a CORS_ALLOW_ORIGINS del Command Center.
  const ccApi = (process.env.AUDIT_SOUND_CC_API || process.env.CC_API_URL || '').replace(/\/+$/, '');
  // Modo demo OPT-IN (por defecto APAGADO): sin AUDIT_SOUND_CC_API el login se
  // bloquea, salvo que se habilite a propósito AUDIT_SOUND_ALLOW_DEMO=1.
  const allowDemo = /^(1|true|yes)$/i.test(String(process.env.AUDIT_SOUND_ALLOW_DEMO || ''));
  if (ccApi) {
    body += `window.AUDIT_SOUND_CC_API=${JSON.stringify(ccApi)};\n`;
    if (process.env.AUDIT_SOUND_CC_LOGIN_PATH) body += `window.AUDIT_SOUND_CC_LOGIN_PATH=${JSON.stringify(process.env.AUDIT_SOUND_CC_LOGIN_PATH)};\n`;
    if (process.env.AUDIT_SOUND_CC_ME_PATH) body += `window.AUDIT_SOUND_CC_ME_PATH=${JSON.stringify(process.env.AUDIT_SOUND_CC_ME_PATH)};\n`;
  }
  if (allowDemo) body += `window.AUDIT_SOUND_ALLOW_DEMO=true;\n`;
  // Solo se publica SI hay agente (nunca su URL interna ni credenciales).
  body += `window.AUDIT_SOUND_AGENT=${AGENT.url ? 'true' : 'false'};\n`;
  fs.writeFileSync(path.join(ROOT, 'config.js'), body);
  if (listen) console.log('config.js: LISTEN_URL=' + listen);
  console.log('config.js: música libre ' + (OM.clientId ? 'ACTIVADA (Jamendo)' : 'desactivada (sin JAMENDO_CLIENT_ID)'));
  console.log('config.js: Internet Archive ' + (IA.enabled ? 'ACTIVADO' : 'desactivado'));
  console.log('config.js: agente DJ ' + (AGENT.url ? 'CONECTADO por proxy' : 'sin configurar (modo demostración)'));
  console.log('config.js: Command Center ' + (ccApi
    ? ('LIGADO (' + ccApi + ')')
    : (allowDemo ? 'sin ligar — MODO DEMO habilitado (AUDIT_SOUND_ALLOW_DEMO)'
                 : 'sin ligar — LOGIN BLOQUEADO (define AUDIT_SOUND_CC_API)')));
} catch (e) { /* no crítico */ }

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
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

// --- Proxy: búsqueda en Internet Archive (advancedsearch, solo audio) ---
async function handleArchiveSearch(u, res) {
  if (!IA.enabled) return sendJson(res, 503, { error: 'Internet Archive desactivado en el servidor.' });
  const q = (u.searchParams.get('q') || '').trim();
  const limit = Math.min(50, Math.max(1, parseInt(u.searchParams.get('limit') || '30', 10)));
  // Sin término: mostrar colecciones de netlabels (música libre). Con término: audio.
  const query = q ? `(${q}) AND mediatype:audio` : 'collection:netlabels AND mediatype:audio';
  const api = `${IA.apiBase}/advancedsearch.php?q=${encodeURIComponent(query)}` +
    `&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&rows=${limit}&page=1&output=json`;
  let r;
  try { r = await fetch(api); } catch (e) { return sendJson(res, 502, { error: 'no se pudo consultar Internet Archive: ' + (e.message || e) }); }
  if (!r.ok) return sendJson(res, 502, { error: 'Internet Archive respondió HTTP ' + r.status });
  let j; try { j = await r.json(); } catch (e) { return sendJson(res, 502, { error: 'respuesta no válida de Internet Archive' }); }
  const docs = (j.response && j.response.docs) || [];
  const results = docs.filter((d) => d.identifier).map((d) => ({
    id: String(d.identifier),
    title: d.title || d.identifier,
    artist: Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || ''),
    license: d.licenseurl || '',
  }));
  sendJson(res, 200, { results });
}

// --- Proxy: audio de un item de Internet Archive (metadata -> elige archivo -> stream) ---
// Reconoce el audio por la extensión del nombre O por el campo `format` (archive.org
// usa "VBR MP3", "Ogg Vorbis", "Flac", "AIFF"…, que la extensión del nombre a veces no
// refleja). Antes solo miraba el nombre + "mp3" en formato, así que items de audio con
// derivados nombrados de otra forma caían a 404 "sin archivo reproducible".
const IA_AUDIO_RE = /\.(mp3|ogg|oga|flac|m4a|aac|aif|aiff|wav|wave|opus)$/i;
const IA_AUDIO_FMT_RE = /(mp3|mpeg\s*audio|ogg|vorbis|opus|flac|m4a|aac|aiff|wav|wave|shorten)/i;
function iaIsAudioFile(f) {
  if (!f || !f.name) return false;
  return IA_AUDIO_RE.test(f.name) || IA_AUDIO_FMT_RE.test(String(f.format || ''));
}
// Elige el mejor audio reproducible en navegador: MP3 primero (ligero y universal),
// luego ogg/opus, m4a/aac, flac y por último wav (originales enormes). El original se
// usa solo como desempate; se penalizan las muestras cortas.
function pickArchiveAudioFile(files) {
  const audios = (files || []).filter(iaIsAudioFile);
  if (!audios.length) return null;
  const score = (f) => {
    const fmt = String(f.format || '').toLowerCase();
    const name = String(f.name || '').toLowerCase();
    let s = 0;
    if (/mp3|mpeg\s*audio/.test(fmt) || name.endsWith('.mp3')) s += 60;
    else if (/ogg|vorbis|opus/.test(fmt) || /\.(ogg|oga|opus)$/.test(name)) s += 45;
    else if (/m4a|aac/.test(fmt) || /\.(m4a|aac)$/.test(name)) s += 30;
    else if (/flac/.test(fmt) || name.endsWith('.flac')) s += 15;
    else if (/wav|wave|aiff|shorten/.test(fmt) || /\.(wav|wave|aif|aiff)$/.test(name)) s += 5;
    if (f.source === 'original') s += 3;                       // desempate
    if (/sample|preview|snippet|_spectrogram/.test(name)) s -= 50;
    return s;
  };
  return audios.slice().sort((a, b) => score(b) - score(a))[0];
}
async function handleArchiveAudio(u, res) {
  if (!IA.enabled) return sendJson(res, 503, { error: 'Internet Archive desactivado en el servidor.' });
  const id = u.searchParams.get('id') || '';
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return sendJson(res, 400, { error: 'identificador inválido' });
  let meta;
  try {
    const mr = await fetch(`${IA.apiBase}/metadata/${encodeURIComponent(id)}`);
    if (!mr.ok) return sendJson(res, 502, { error: 'no se pudo leer metadata: HTTP ' + mr.status });
    meta = await mr.json();
  } catch (e) { return sendJson(res, 502, { error: 'no se pudo leer metadata: ' + (e.message || e) }); }
  const files = (meta && meta.files) || [];
  const pick = pickArchiveAudioFile(files);
  if (!pick) return sendJson(res, 404, { error: 'este item de Internet Archive no tiene un archivo de audio descargable; prueba con otro resultado' });
  const dl = `${IA.apiBase}/download/${encodeURIComponent(id)}/` +
    pick.name.split('/').map(encodeURIComponent).join('/');
  let target;
  try { target = new URL(dl); } catch (e) { return sendJson(res, 400, { error: 'url inválida' }); }
  if (!iaHostOk(target.host)) return sendJson(res, 403, { error: 'host de audio no permitido: ' + target.host });
  let r;
  try { r = await fetch(target.href, { redirect: 'follow' }); } catch (e) { return sendJson(res, 502, { error: 'no se pudo descargar: ' + (e.message || e) }); }
  if (!r.ok) return sendJson(res, 502, { error: 'la fuente respondió HTTP ' + r.status });
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > IA.maxBytes) return sendJson(res, 413, { error: 'archivo demasiado grande' });
  const ct = r.headers.get('content-type') || 'audio/mpeg';
  res.writeHead(200, headers(ct.includes('audio') ? ct : 'audio/mpeg'));
  res.end(buf);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(u.pathname);
  if (pathname === '/healthz') return send(res, 200, 'ok\n', 'text/plain');
  if (pathname.startsWith(AGENT_PREFIX) || pathname === AGENT_PREFIX.slice(0, -1)) return proxyAgent(req, res, u.pathname + u.search);
  if (pathname === '/api/openmusic/search') { handleSearch(u, res).catch((e) => sendJson(res, 500, { error: String(e && e.message || e) })); return; }
  if (pathname === '/api/openmusic/audio') { handleAudio(u, res).catch((e) => sendJson(res, 500, { error: String(e && e.message || e) })); return; }
  if (pathname === '/api/archive/search') { handleArchiveSearch(u, res).catch((e) => sendJson(res, 500, { error: String(e && e.message || e) })); return; }
  if (pathname === '/api/archive/audio') { handleArchiveAudio(u, res).catch((e) => sendJson(res, 500, { error: String(e && e.message || e) })); return; }

  // Compatibilidad con enlaces/marcadores viejos bajo /pro/: este sitio se sirve en la
  // RAÍZ del dominio (WEB_ROOT=web/pro), así que /pro/login.html no existe. Antes caía al
  // fallback de index.html y, como index.html redirige a ./login.html (otra vez /pro/…),
  // se producía un bucle infinito y pantalla negra. Redirigimos /pro/x -> /x (301).
  if (pathname === '/pro' || pathname === '/pro/') { res.writeHead(301, { Location: '/' }); return res.end(); }
  if (pathname.startsWith('/pro/')) {
    const dest = (pathname.slice(4) || '/') + (u.search || '');  // quita "/pro", conserva query
    res.writeHead(301, { Location: dest }); return res.end();
  }

  let rel = pathname.replace(/^\/+/, '') || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';  // /v06/ -> /v06/index.html (índice de carpeta)
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden');  // evita traversal
  fs.readFile(file, (err, buf) => {
    if (err) {
      // Solo las NAVEGACIONES (ruta sin extensión de archivo) caen a index.html. Un
      // archivo con extensión que no existe devuelve 404 real: así nunca servimos HTML
      // en lugar de una imagen/JS (lo que rompía el render) ni alimentamos bucles de
      // redirección.
      if (path.extname(rel)) return send(res, 404, 'not found');
      fs.readFile(path.join(ROOT, 'index.html'), (e2, idx) => {
        if (e2) return send(res, 404, 'not found');
        send(res, 200, idx, TYPES['.html']);
      });
      return;
    }
    send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream');
  });
});

server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url || '/', `http://localhost:${PORT}`);
  if (u.pathname.startsWith(AGENT_PREFIX)) return proxyAgentUpgrade(req, socket, head, u.pathname + u.search);
  socket.destroy();
});

// Arranca solo cuando se ejecuta directamente (node server.js); al requerirlo desde
// una prueba (p. ej. del selector de audio de Internet Archive) no abre el puerto.
if (require.main === module) {
  server.listen(PORT, () => console.log(`AUDIT SOUND PRO en :${PORT} (root=${ROOT})`));
}

module.exports = { server, pickArchiveAudioFile, iaIsAudioFile };

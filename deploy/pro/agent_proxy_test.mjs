// Prueba del proxy del agente DJ (Fase 5): /api/v1/dj-agent/* (HTTP y WebSocket) → DJ_AGENT_URL.
// Arranca server.js contra un AGENTE SIMULADO y verifica: reenvío de método/cuerpo/cabeceras
// permitidas, que NO se reenvían cookies, 503 sin configurar, 502 con el agente caído, tope de
// tamaño y el túnel WebSocket. Uso: node deploy/pro/agent_proxy_test.mjs (desde la raíz).
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA ') + m); if (!c) fails++; };

// --- Agente simulado (HTTP + WebSocket mínimo) ---
let seen = null;
const agent = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen = { method: req.method, url: req.url, headers: req.headers, body };
    res.writeHead(201, { 'content-type': 'application/json', 'x-correlation-id': 'corr-123' });
    res.end(JSON.stringify({ ok: true, echo: body ? JSON.parse(body) : null }));
  });
});
agent.on('upgrade', (req, socket) => {
  const accept = crypto.createHash('sha1')
    .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const msg = Buffer.from(JSON.stringify({ type: 'session.snapshot', path: req.url }));
  socket.write(Buffer.concat([Buffer.from([0x81, msg.length]), msg]));   // un frame de texto sin máscara
});
await new Promise((r) => agent.listen(0, '127.0.0.1', r));
const AGENT_URL = `http://127.0.0.1:${agent.address().port}`;

function startServer(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const root = mkdtempSync(join(tmpdir(), 'as-web-'));
  const p = spawn(process.execPath, [join(HERE, 'server.js')], {
    env: { ...process.env, PORT: String(port), WEB_ROOT: root, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve) => {
    p.stdout.on('data', (d) => { if (String(d).includes('AUDIT SOUND PRO en')) resolve({ p, port, root }); });
  });
}

// 1) Con agente configurado
{
  const { p, port, root } = await startServer({ DJ_AGENT_URL: AGENT_URL, DJ_AGENT_MAX_BODY: '2048' });
  const base = `http://127.0.0.1:${port}`;
  const r = await fetch(`${base}/api/v1/dj-agent/sessions/s1/intent?x=1`, {
    method: 'POST', body: JSON.stringify({ text: 'salta' }),
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok', 'idempotency-key': 'k1',
      cookie: 'sesion=secreta', 'x-otra': 'no' } });
  const j = await r.json();
  ok(r.status === 201 && j.echo.text === 'salta', 'POST reenviado con cuerpo y código del agente');
  ok(seen.url === '/api/v1/dj-agent/sessions/s1/intent?x=1' && seen.method === 'POST', 'ruta y query intactas');
  ok(seen.headers.authorization === 'Bearer tok' && seen.headers['idempotency-key'] === 'k1', 'cabeceras permitidas reenviadas');
  ok(!seen.headers.cookie && !seen.headers['x-otra'], 'cookies y cabeceras ajenas NO se reenvían');
  ok(r.headers.get('cross-origin-embedder-policy') === 'require-corp', 'la respuesta conserva COOP/COEP');
  ok(r.headers.get('x-correlation-id') === 'corr-123', 'se devuelve el id de correlación');
  const big = await fetch(`${base}/api/v1/dj-agent/sessions`, { method: 'POST', body: 'x'.repeat(5000) }).catch(() => null);
  ok(!big || big.status === 413, 'cuerpo demasiado grande rechazado');
  const cfg = await fetch(`${base}/config.js`).then((x) => x.text());
  ok(cfg.includes('window.AUDIT_SOUND_AGENT=true') && !cfg.includes(AGENT_URL), 'config.js anuncia el agente sin revelar su URL');

  // WebSocket a través del proxy
  // Cliente WebSocket mínimo con http (Node 20 no trae WebSocket global): saludo + primer frame.
  const got = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 3000);
    const req = http.request({ host: '127.0.0.1', port, path: '/api/v1/dj-agent/sessions/s1/events', headers: {
      connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13',
      'sec-websocket-key': crypto.randomBytes(16).toString('base64') } });
    req.on('upgrade', (res, sock, head) => {
      let buf = head || Buffer.alloc(0);
      const tryParse = () => {
        if (buf.length < 2) return;
        const len = buf[1] & 0x7f;
        if (buf.length < 2 + len) return;
        clearTimeout(t); sock.destroy();
        resolve(res.statusCode === 101 ? JSON.parse(buf.subarray(2, 2 + len).toString()) : null);
      };
      sock.on('data', (d) => { buf = Buffer.concat([buf, d]); tryParse(); });
      tryParse();
    });
    req.on('error', () => { clearTimeout(t); resolve(null); });
    req.end();
  });
  ok(got && got.type === 'session.snapshot' && got.path === '/api/v1/dj-agent/sessions/s1/events', 'WebSocket tunelizado al agente');
  p.kill();
  void root;
}

// 1b) Límite de peticiones por IP
{
  const { p, port } = await startServer({ DJ_AGENT_URL: AGENT_URL, DJ_AGENT_RATE_PER_MIN: '5' });
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await fetch(`http://127.0.0.1:${port}/api/v1/dj-agent/health`)).status);
  const r = await fetch(`http://127.0.0.1:${port}/api/v1/dj-agent/health`);
  ok(codes.slice(0, 5).every((c) => c === 201) && codes[5] === 429 && r.headers.get('retry-after') === '30',
    `límite de peticiones por IP (5/min): ${codes.join(',')}`);
  const h = await fetch(`http://127.0.0.1:${port}/healthz`);
  ok(h.status === 200, 'el límite solo aplica al agente (la consola sigue respondiendo)');
  p.kill();
}

// 2) Agente caído
{
  const { p, port } = await startServer({ DJ_AGENT_URL: 'http://127.0.0.1:1' });
  const r = await fetch(`http://127.0.0.1:${port}/api/v1/dj-agent/health`);
  const j = await r.json();
  ok(r.status === 502 && j.error.code === 'agent_unreachable', 'agente caído → 502 con mensaje claro');
  p.kill();
}

// 3) Sin configurar
{
  const { p, port } = await startServer({ DJ_AGENT_URL: '' });
  const r = await fetch(`http://127.0.0.1:${port}/api/v1/dj-agent/health`);
  ok(r.status === 503 && (await r.json()).error.code === 'agent_not_configured', 'sin DJ_AGENT_URL → 503');
  const cfg = await fetch(`http://127.0.0.1:${port}/config.js`).then((x) => x.text());
  ok(cfg.includes('window.AUDIT_SOUND_AGENT=false'), 'config.js indica modo demostración');
  p.kill();
}

agent.close();
console.log(fails ? `\n${fails} FALLA(S)` : '\nTODO OK');
process.exit(fails ? 1 : 0);

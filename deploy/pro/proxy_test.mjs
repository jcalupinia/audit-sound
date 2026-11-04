// Prueba de integración del proxy de música libre (Etapa A / A2).
// Arranca server.js contra un UPSTREAM SIMULADO (Jamendo + Internet Archive) y
// verifica la normalización de resultados y la seguridad del proxy (lista blanca de
// hosts de audio, validación de identificador). NO consulta las APIs reales (eso
// requiere JAMENDO_CLIENT_ID + red; se corre en el preview desplegado).
//
// Uso: node deploy/pro/proxy_test.mjs   (desde la raíz del repo)
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AUDIO = Buffer.from('ID3mock-audio-bytes-0123456789');  // "audio" simulado

// --- Upstream simulado (hace de Jamendo y de Internet Archive) ---
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const j = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/tracks/') {
    return j({ results: [{ id: 42, name: 'Tema Libre', artist_name: 'Artista CC', duration: 190,
      audio: `http://${MOCKHOST}/aud/42.mp3`, license_ccurl: 'http://creativecommons.org/licenses/by-sa/3.0/', album_name: 'Álbum' }] });
  }
  if (u.pathname === '/aud/42.mp3' || u.pathname.startsWith('/download/')) {
    res.writeHead(200, { 'content-type': 'audio/mpeg' }); return res.end(AUDIO);
  }
  if (u.pathname === '/advancedsearch.php') {
    return j({ response: { docs: [{ identifier: 'item-demo', title: 'Grabación IA', creator: ['Sello X'],
      licenseurl: 'https://creativecommons.org/publicdomain/mark/1.0/' }] } });
  }
  if (u.pathname.startsWith('/metadata/')) {
    return j({ files: [{ name: 'pista.mp3', format: 'VBR MP3' }, { name: 'cover.jpg', format: 'JPEG' }] });
  }
  res.writeHead(404); res.end('no');
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const MPORT = mock.address().port;
const MOCKHOST = `127.0.0.1:${MPORT}`;
const MOCK = `http://${MOCKHOST}`;

// --- server.js con el upstream simulado ---
const PORT = 18980;
const webRoot = mkdtempSync(join(tmpdir(), 'audit_proxy_web_'));
const child = spawn(process.execPath, ['deploy/pro/server.js'], {
  env: { ...process.env, PORT: String(PORT), WEB_ROOT: webRoot,
    JAMENDO_CLIENT_ID: 'dummy', JAMENDO_API_BASE: MOCK, OPENMUSIC_AUDIO_HOSTS: MOCKHOST,
    ARCHIVE_ENABLED: 'true', ARCHIVE_API_BASE: MOCK },
  stdio: 'ignore',
});
const BASE = `http://127.0.0.1:${PORT}`;
// esperar a que escuche
for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/openmusic/search?q=a'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK  ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// 1) Jamendo search → normalizado
{
  const r = await fetch(`${BASE}/api/openmusic/search?q=tema&limit=5`); const j = await r.json();
  const t = (j.results || [])[0] || {};
  ok(r.status === 200 && t.id === '42' && t.title === 'Tema Libre' && t.artist === 'Artista CC' && /by-sa/.test(t.license) && t.audio,
     'Jamendo search → resultados normalizados (id,title,artist,license,audio)');
}
// 2) Jamendo audio proxy: host permitido → bytes; host no permitido → 403
{
  const good = await fetch(`${BASE}/api/openmusic/audio?url=${encodeURIComponent(MOCK + '/aud/42.mp3')}`);
  const buf = Buffer.from(await good.arrayBuffer());
  ok(good.status === 200 && buf.length === AUDIO.length, 'Jamendo audio (host permitido) → bytes');
  const evil = await fetch(`${BASE}/api/openmusic/audio?url=${encodeURIComponent('http://evil.example/x.mp3')}`);
  ok(evil.status === 403, 'Jamendo audio (host NO permitido) → 403 (lista blanca)');
}
// 3) Archive search → normalizado
{
  const r = await fetch(`${BASE}/api/archive/search?q=grab&limit=5`); const j = await r.json();
  const d = (j.results || [])[0] || {};
  ok(r.status === 200 && d.id === 'item-demo' && d.title === 'Grabación IA' && d.artist === 'Sello X' && /publicdomain/.test(d.license),
     'Archive search → resultados normalizados (id,title,artist,license)');
}
// 4) Archive audio: id válido → bytes; id inválido → 400
{
  const good = await fetch(`${BASE}/api/archive/audio?id=item-demo`);
  const buf = Buffer.from(await good.arrayBuffer());
  ok(good.status === 200 && buf.length === AUDIO.length, 'Archive audio (id válido) → bytes (metadata→download)');
  const bad = await fetch(`${BASE}/api/archive/audio?id=${encodeURIComponent('../../etc/passwd')}`);
  ok(bad.status === 400, 'Archive audio (id inválido) → 400 (validación)');
}

child.kill('SIGKILL'); mock.close();
console.log(`\nRESULTADO: ${pass} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);

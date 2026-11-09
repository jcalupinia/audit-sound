// «Escuchar en vivo» de la v0.6 reproduce el stream REAL del servidor sin que el usuario escriba la URL.
// Simula el Icecast público con un servidor local que sirve un MP3 (audio/mpeg) y arranca la consola
// con LISTEN_URL apuntando a él, como en producción. Comprueba que el audio avanza de verdad.
// El servidor de audio simulado responde como el Icecast de producción: SIN la cabecera
// Cross-Origin-Resource-Policy primero (la consola usa COEP require-corp → el navegador lo bloquea,
// error 4: el «no suena nada» que se vio en producción) y CON ella después (deploy/icecast).
// Uso: node web/pro/v06/tests/escuchar_stream_e2e.mjs (desde la raíz del repo).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MP3 = readFileSync(join(HERE, 'stream_prueba.mp3'));   // 12 s de tono de 440 Hz
let pedidos = 0;
let conCorp = false;
const ice = http.createServer((req, res) => {
  if (req.url !== '/stream.mp3') { res.writeHead(404); return res.end(); }
  pedidos++; res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': MP3.length, ...(conCorp ? { 'cross-origin-resource-policy': 'cross-origin', 'access-control-allow-origin': '*' } : {}) }); res.end(MP3);
});
await new Promise((r) => ice.listen(0, '127.0.0.1', r));
const LISTEN = `http://127.0.0.1:${ice.address().port}`;
const WEB = 18000 + Math.floor(Math.random() * 1000);
const web = spawn(process.execPath, [join(REPO, 'deploy/pro/server.js')],
  { env: { ...process.env, PORT: String(WEB), WEB_ROOT: join(REPO, 'web/pro'), DJ_AGENT_URL: '', LISTEN_URL: LISTEN }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => web.stdout.on('data', (d) => String(d).includes('AUDIT SOUND PRO en') && r()));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const p = await browser.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`http://127.0.0.1:${WEB}/v06/`);
  await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.locator('button[data-action=guest]').click();
  await p.evaluate(() => document.querySelector('button.navbtn[data-page="en-vivo"]').click());
  const url = await p.locator('form[data-form=stream] input[name=streamUrl]').inputValue();
  ok(url === LISTEN + '/stream.mp3', `la URL del stream viene puesta (${url})`);
  await p.locator('button[data-action=stream-play]').click();
  await sleep(1500);
  ok(await p.evaluate(() => window.__ASLIVE.time()) === 0 && (await p.locator('main').innerText()).includes('DETENIDA'),
    'sin la cabecera CORP del servidor de audio no suena y la consola lo indica (causa del fallo en producción)');
  conCorp = true;
  await p.locator('button[data-action=stream-play]').click();
  let t = 0;
  for (let i = 0; i < 40 && t < 1.5; i++) { await sleep(150); t = await p.evaluate(() => window.__ASLIVE.time()); }
  ok(t >= 1.5, `el audio del stream suena y avanza (${t.toFixed(2)} s)`);
  ok(pedidos > 0, 'el reproductor pidió el stream al servidor de audio, no a la consola');
  ok((await p.locator('main').innerText()).includes('SONANDO'), 'la página indica «SONANDO»');
  await p.evaluate(() => document.querySelector('button.navbtn[data-page="consola"]').click());
  await sleep(800);
  ok(!(await p.evaluate(() => window.__ASLIVE.paused())), 'sigue sonando al cambiar de página (no se corta al redibujar)');
  await p.evaluate(() => document.querySelector('button.navbtn[data-page="en-vivo"]').click());
  await p.locator('button[data-action=stream-stop]').click();
  ok(await p.evaluate(() => window.__ASLIVE.paused()), '■ Detener lo apaga');
  ok(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { ok(false, 'excepción: ' + (e && e.stack || e)); } finally { await browser.close(); web.kill(); ice.close(); }
console.log('\n' + (fails ? `${fails} FALLA(S)` : 'TODO OK'));
process.exit(fails ? 1 : 0);

// Bloque 2 · V2 en Chromium: pantalla 2 (proyector) y «Enviar a programa» con transición real.
// Con dos videos de color sólido (rojo A, azul B) comprueba, leyendo el video que muestra la VENTANA de la
// pantalla 2 (lo que ve el público):
//   - se abre una ventana aparte que muestra solo la salida Programa;
//   - sin programa, el público ve negro (no textos de la consola);
//   - «Enviar a programa» con Desvanecer pasa por una mezcla intermedia y termina en la mezcla elegida;
//   - con Corte el cambio es inmediato; con Barrido avanza de izquierda a derecha;
//   - «Pánico» muestra el logo fijo al instante y al volver regresa el programa;
//   - cerrar la ventana se detecta en la consola; sin errores de JavaScript.
// Uso: node web/pro/v06/tests/video_v2_pantalla2_e2e.mjs (desde la raíz del repo).
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const WEB = 18000 + Math.floor(Math.random() * 1000);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) { /* reintenta */ } await sleep(60); }
  return false;
}
const near = (px, rgb, tol = 45) => px && rgb.every((v, i) => Math.abs(px[i] - v) <= tol);

const web = spawn(process.execPath, [join(REPO, 'deploy/pro/server.js')],
  { env: { ...process.env, PORT: String(WEB), WEB_ROOT: join(REPO, 'web/pro'), DJ_AGENT_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => web.stdout.on('data', (d) => String(d).includes('AUDIT SOUND PRO en') && r()));
const browser = await chromium.launch();
const errors = [];

const setRange = (p, change, v) => p.evaluate(([c, v]) => {
  const el = document.querySelector(`input[data-change="${c}"]`); el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
}, [change, v]);
const setSelect = (p, change, v) => p.evaluate(([c, v]) => {
  const el = document.querySelector(`[data-change="${c}"]`); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true }));
}, [change, v]);
// Lo que ve el público: un píxel del video de la ventana de la pantalla 2.
const pub = (p, x = 0.5, y = 0.5) => p.evaluate(([x, y]) => window.__ASP2.sample(x, y), [x, y]);
async function pubIs(p, rgb, x = 0.5, y = 0.5, ms = 4000) {
  let last = null;
  const r = await until(async () => { last = await pub(p, x, y); return near(last, rgb); }, ms);
  if (!r) console.log(`      (pantalla 2 en ${x},${y}: ${last && last.slice(0, 3)}; esperado ${rgb})`);
  return r;
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push('consola: ' + e));
  await p.goto(`http://127.0.0.1:${WEB}/v06/`);
  await p.locator('button[data-action=guest]').click();
  await p.locator('button.navbtn[data-page=video]').first().click();
  ok(await until(() => p.evaluate(() => window.__ASVJ && window.__ASVJ.mode)), 'compositor iniciado');
  await p.locator('input[data-file="video-A"]').setInputFiles(join(HERE, 'video_rojo.webm'));
  await p.locator('input[data-file="video-B"]').setInputFiles(join(HERE, 'video_azul.webm'));
  ok(await until(() => p.evaluate(() => window.__ASVJ.video('A').ready >= 2 && window.__ASVJ.video('B').ready >= 2)), 'videos cargados en A y B');
  for (const d of ['A', 'B']) {
    await p.locator(`button[data-action=video-loop][data-deck=${d}]`).click();
    await p.locator(`button[data-action=video-play][data-deck=${d}]`).click();
  }

  // 1) Abrir la pantalla 2
  const [win] = await Promise.all([p.waitForEvent('popup'), p.locator('button[data-action=p2-open]').first().click()]);
  win.on('pageerror', (e) => errors.push('pantalla 2: ' + e));
  ok(await win.title() === 'AUDIT SOUND · Programa', 'se abre la ventana «Programa» para el proyector');
  ok(await until(async () => { const s = await p.evaluate(() => window.__ASP2.size()); return s && s[0] === 1280 && s[1] === 720; }),
    'la pantalla 2 recibe la salida Programa en 1280×720');
  ok(await win.evaluate(() => document.querySelectorAll('button,input,select').length === 0), 'la pantalla 2 no muestra controles de la consola');
  ok((await p.locator('main').innerText()).includes('Pantalla 2: ABIERTA'), 'la consola indica que la pantalla 2 está abierta');
  ok(await pubIs(p, [3, 7, 11], 0.5, 0.5), 'sin programa, el público ve negro (sin textos de la consola)');

  // 2) Enviar a programa con Desvanecer → hay cuadros intermedios y termina en la mezcla (A = rojo)
  await setSelect(p, 'video-transition', 'fade');
  await setRange(p, 'video-cross', 0);
  await sleep(300);
  const seen = [];
  const watch = (async () => { const t0 = Date.now(); while (Date.now() - t0 < 2500) { const s = await pub(p); if (s) seen.push(s.slice(0, 3)); await sleep(30); } })();
  await p.locator('button[data-action=video-take]').first().click();
  await watch;
  ok(seen.some((s) => s[0] > 30 && s[0] < 200), `desvanecer: el público ve cuadros intermedios (${seen.length} lecturas)`);
  ok(await pubIs(p, [255, 0, 0]), 'desvanecer: termina en el deck A (rojo) en la pantalla 2');

  // 3) El programa sigue a la mezcla en vivo: crossfader a B → azul
  await setRange(p, 'video-cross', 100);
  ok(await pubIs(p, [0, 0, 255]), 'con el programa al aire, el crossfader cambia lo que ve el público (azul)');

  // 4) Detener con Corte: negro inmediato
  await setSelect(p, 'video-transition', 'cut');
  await p.locator('button[data-action=video-stop]').first().click();
  ok(await pubIs(p, [3, 7, 11], 0.5, 0.5, 1200), 'detener con Corte: negro al instante');

  // 5) Barrido: entra de izquierda a derecha
  await setSelect(p, 'video-transition', 'wipe');
  await p.locator('button[data-action=video-take]').first().click();
  const wiped = await until(async () => { const l = await pub(p, 0.1, 0.5), r = await pub(p, 0.9, 0.5); return near(l, [0, 0, 255]) && near(r, [3, 7, 11]); }, 1500);
  ok(wiped, 'barrido: a mitad de la transición la izquierda ya es azul y la derecha aún negra');
  ok(await pubIs(p, [0, 0, 255], 0.9, 0.5), 'barrido: termina con toda la pantalla en azul');

  // 6) Pánico: logo fijo al instante; al volver regresa el programa
  await p.locator('button[data-action=video-panic]').first().click();
  ok(await pubIs(p, [0, 0, 0], 0.05, 0.05, 1200), 'pánico: fondo negro al instante');
  ok(await until(async () => { for (let x = 0.3; x <= 0.7; x += 0.01) { const s = await pub(p, x, 0.5); if (s && s[1] > 150 && s[0] < 200) return true; } return false; }, 2000),
    'pánico: el logo «AUDIT SOUND» aparece al centro');
  await setRange(p, 'video-cross', 0);
  await sleep(400);
  ok(near(await pub(p, 0.05, 0.05), [0, 0, 0]), 'pánico: mover el crossfader no cambia lo que ve el público');
  await p.locator('button[data-action=video-panic]').first().click();
  ok(await pubIs(p, [255, 0, 0]), 'al quitar el pánico vuelve el programa en vivo (rojo)');

  // 7) Cerrar la ventana se detecta en la consola
  await win.close();
  ok(await until(async () => !(await p.evaluate(() => window.__ASP2.open())) &&
    (await p.locator('main').innerText()).includes('Abrir pantalla 2'), 3000), 'cerrar la pantalla 2 se refleja en la consola');

  // 8) Teléfono: la barra de pantalla 2 no desborda
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const q = await ph.newPage();
  q.on('pageerror', (e) => errors.push('teléfono: ' + e));
  await q.goto(`http://127.0.0.1:${WEB}/v06/`);
  await q.locator('button[data-action=guest]').click();
  await q.evaluate(() => document.querySelector('button.navbtn[data-page=video]').click());
  await sleep(500);
  ok(await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'teléfono: la pantalla de video no desborda');
  ok(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) {
  ok(false, 'excepción: ' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log('\n' + (fails ? `${fails} FALLA(S)` : 'TODO OK'));
process.exit(fails ? 1 : 0);

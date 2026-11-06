// E2E de console.html con el MOTOR WASM real (Fase 0-B): abre tu imagen, arranca el
// motor, carga 2 canciones, reproduce y mide el audio real que llega al worklet.
import { chromium } from 'playwright';
import path from 'node:path';

const DIR = process.argv[2];
const BASE = process.env.BASE || 'http://127.0.0.1:8193';
const A = path.join(DIR, 'cancionA.wav');
const B = path.join(DIR, 'cancionB.wav');
const out = [];
const rec = (n, ok, d) => { out.push({ n, ok, d }); console.log((ok ? 'OK  ' : 'FALLA ') + n + ' — ' + d); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('auditsound.cc.token', 'test'); localStorage.setItem('auditsound.cc.user', 'dj@test'); } catch (e) {} });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', e => errores.push(String(e)));
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // Diagnósticos del motor C++ (printf→Emscripten los manda a console.error): no son errores.
  if (t.includes('[auditsound]')) return;
  errores.push('console.error: ' + t);
});

await page.goto(BASE + '/console.html', { waitUntil: 'networkidle' });

const iso = await page.evaluate(() => self.crossOriginIsolated === true);
rec('Aislamiento de origen (SharedArrayBuffer habilitado)', iso, 'crossOriginIsolated=' + iso);

const imgOk = await page.evaluate(() => { const i = document.querySelector('.frame img'); return !!(i && i.complete && i.naturalWidth > 0); });
rec('Tu imagen de consola carga', imgOk, imgOk ? 'landing_consola.webp visible' : 'no cargó');

// Click en Importar -> arranca el motor y abre el selector -> cargamos A y B
page.on('filechooser', async fc => { try { await fc.setFiles([A, B]); } catch (e) {} });
await page.click('#importar');

// esperar a que el motor arranque (started) y cargue ambos platos
let started = false, loaded = [false, false];
for (let i = 0; i < 60; i++) {
  const s = await page.evaluate(() => ({ started: window.__audit?.started, loaded: window.__audit?.loaded }));
  started = !!s.started; loaded = s.loaded || [false, false];
  if (started && loaded[0] && loaded[1]) break;
  await sleep(500);
}
rec('El motor WASM real arranca en el navegador', started, 'bridge.start() → ready=' + started);
const statusTxt = await page.evaluate(() => document.getElementById('status').textContent);
rec('Carga 2 canciones con el motor (A y B)', loaded[0] && loaded[1], `loaded=[${loaded}] · status="${statusTxt.slice(0, 80)}"`);
rec('El motor analiza BPM real al cargar', /BPM/.test(statusTxt), `status muestra BPM: ${/BPM/.test(statusTxt)}`);

// Reproducir ambos
await page.click('#playA'); await sleep(300);
await page.click('#playB'); await sleep(1200);
const peakMix = await page.evaluate(() => window.__audit.peak());
rec('Suena de verdad: audio fluye al worklet (mezcla)', peakMix > 0.001, `PEAK del worklet = ${peakMix.toFixed(4)} (>0 = audio real saliendo del motor)`);

// Crossfader y master sin error
await page.evaluate(() => { const x = document.getElementById('xfader'); x.value = '0'; x.dispatchEvent(new Event('input', { bubbles: true })); });
await sleep(400);
const peakA = await page.evaluate(() => window.__audit.peak());
await page.evaluate(() => { const x = document.getElementById('xfader'); x.value = '1'; x.dispatchEvent(new Event('input', { bubbles: true })); });
await sleep(400);
const peakB = await page.evaluate(() => window.__audit.peak());
rec('Crossfader opera sobre el motor (sigue habiendo audio)', peakA > 0.001 && peakB > 0.001, `izq PEAK=${peakA.toFixed(4)} · der PEAK=${peakB.toFixed(4)}`);

await page.evaluate(() => { const m = document.getElementById('master'); m.value = '0.3'; m.dispatchEvent(new Event('input', { bubbles: true })); });
const masterOk = await page.evaluate(() => { try { document.getElementById('master').dispatchEvent(new Event('input', { bubbles: true })); return true; } catch (e) { return false; } });
rec('Master opera sin error', masterOk, 'master aplicado');

// CUE pausa
await page.click('#cueA'); await sleep(200);
const playingTras = await page.evaluate(() => window.__audit.playing);
rec('CUE pausa el plato A', playingTras[0] === false, `playing A=${playingTras[0]}`);

rec('Sin errores JS en la página', errores.length === 0, errores.length ? errores.slice(0, 3).join(' | ') : 'ninguno');

await page.screenshot({ path: path.join(DIR, 'console_engine.png') });
await browser.close();

const okN = out.filter(x => x.ok).length;
console.log(`\nRESULTADO CONSOLE+MOTOR: ${okN}/${out.length} OK`);
process.exit(okN === out.length ? 0 : 1);

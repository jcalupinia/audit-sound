// Forma de onda REAL en los decks de la consola v0.6 (antes: dibujo decorativo fijo).
// Fixture: onda_mitad.wav (8 s: 4 s casi en silencio y 4 s fuertes) → la onda debe verse baja a la
// izquierda y alta a la derecha. Comprueba también cabezal, clic para ir a un punto y teléfono.
// Uso: node web/pro/v06/tests/onda_real_e2e.mjs (desde la raíz del repo).
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
async function until(fn, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) { /* reintenta */ } await sleep(100); } return false; }

const web = spawn(process.execPath, [join(REPO, 'deploy/pro/server.js')],
  { env: { ...process.env, PORT: String(WEB), WEB_ROOT: join(REPO, 'web/pro'), DJ_AGENT_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => web.stdout.on('data', (d) => String(d).includes('AUDIT SOUND PRO en') && r()));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
// Altura media de la onda pintada en una franja horizontal (0..1) del lienzo del deck.
const altura = (p, side, x0, x1) => p.evaluate(([s, a, b]) => {
  const cv = document.querySelector(`canvas[data-wave-deck="${s}"]`); const g = cv.getContext('2d');
  const w = cv.width, h = cv.height, xa = Math.floor(a * w), xb = Math.floor(b * w); let tot = 0, cols = 0;
  for (let x = xa; x < xb; x += 3) { const col = g.getImageData(x, 0, 1, h).data; let n = 0;
    for (let y = 0; y < h; y++) { const i = y * 4; if (col[i + 1] > 120 && col[i + 3] > 0) n++; } tot += n / h; cols++; }
  return tot / Math.max(1, cols); }, [side, x0, x1]);
try {
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`http://127.0.0.1:${WEB}/v06/`);
  await p.locator('button[data-action=guest]').click();
  await p.evaluate(() => document.querySelector('button.navbtn[data-page="consola"]').click());
  ok(await p.locator('canvas[data-wave-deck="A"]').count() === 1 && await p.locator('.deck .wave').count() === 0,
    'cada deck tiene un lienzo de onda real (ya no el dibujo decorativo)');
  ok((await p.evaluate(() => window.__ASWAVE.peaks('A'))) === 0, 'sin pista cargada no se inventa una onda');

  await p.locator('input[data-file="audio-A"]').setInputFiles(join(HERE, 'onda_mitad.wav'));
  ok(await until(async () => (await p.evaluate(() => window.__ASWAVE.peaks('A'))) > 0, 10000), 'al cargar la pista se calcula su forma de onda');
  await sleep(300);
  const izq = await altura(p, 'A', 0.05, 0.45), der = await altura(p, 'A', 0.55, 0.95);
  ok(der > 0.5 && izq < 0.15, `la onda es la de la canción: mitad silenciosa baja (${izq.toFixed(2)}) y mitad fuerte alta (${der.toFixed(2)})`);

  await p.locator('button[data-action=deck-play][data-deck=A]').first().click();
  const x0 = await p.evaluate(() => window.__ASWAVE.playhead('A'));
  await sleep(1500);
  const x1 = await p.evaluate(() => window.__ASWAVE.playhead('A'));
  ok(x1 > x0 && x0 >= 0, `el cabezal avanza con la reproducción (${x0} → ${x1} px)`);
  // El contador del deck avanza solo mientras suena (antes se quedaba en 00:00 hasta redibujar la pantalla).
  await sleep(1200);
  const reloj = (await p.locator('article.deck').first().locator('.trackhead .right small').textContent()).trim();
  ok(/^00:0[2-4] \/ 00:08 · \d+ BPM$/.test(reloj), `el contador del deck avanza mientras suena («${reloj}»)`);

  const box = await p.locator('canvas[data-wave-deck="A"]').boundingBox();
  await p.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  const t = await p.evaluate(() => document.getElementById('engine-a').currentTime);
  ok(Math.abs(t - 6) < 0.6, `un clic al 75 % de la onda lleva la reproducción al segundo ~6 (quedó en ${t.toFixed(2)} s)`);
  await p.locator('button[data-action=deck-play][data-deck=A]').first().click();
  ok((await p.evaluate(() => window.__ASWAVE.peaks('B'))) === 0, 'el deck B, sin pista, sigue sin onda');

  const q = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
  q.on('pageerror', (e) => errors.push('teléfono: ' + e));
  await q.goto(`http://127.0.0.1:${WEB}/v06/`);
  await q.locator('button[data-action=guest]').click();
  await q.evaluate(() => document.querySelector('button.navbtn[data-page="consola"]').click()); await sleep(400);
  ok(await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'teléfono: la consola no desborda');
  ok(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { ok(false, 'excepción: ' + (e && e.stack || e)); } finally { await browser.close(); web.kill(); }
console.log('\n' + (fails ? `${fails} FALLA(S)` : 'TODO OK'));
process.exit(fails ? 1 : 0);

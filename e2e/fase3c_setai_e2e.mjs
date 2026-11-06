// E2E Fase 3C: «Pídele un set a la IA» (recuadro conversacional) sobre la imagen, motor real.
// Comprueba: el lanzador «Generador IA» existe y abre el modal; una petición en texto se
// interpreta (género/nº/energía), arma el set desde la biblioteca y el AutoMix REPRODUCE Y
// MEZCLA solo (PEAK > 0). El parser se prueba aparte en node; aquí va el flujo integrado.
//
//   ARCHIVE_ENABLED=false WEB_ROOT=<tmp> PORT=8203 node deploy/pro/server.js &
//   node e2e/fase3c_setai_e2e.mjs <tmp>   (usa cancionA/B/C.wav de <tmp>)
import { chromium } from 'playwright';
import path from 'node:path';

const DIR = process.argv[2];
const BASE = process.env.BASE || 'http://127.0.0.1:8203';
const files = ['cancionA.wav', 'cancionB.wav', 'cancionC.wav'].map((f) => path.join(DIR, f));
const out = [];
const rec = (n, ok, d) => { out.push({ n, ok, d }); console.log((ok ? 'OK  ' : 'FALLA ') + n + ' — ' + d); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('auditsound.cc.token', 'test'); } catch (e) {} });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('[auditsound]')) errores.push('console.error: ' + m.text()); });

await page.goto(BASE + '/console.html', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__audit && document.getElementById('setaiLaunch'), null, { timeout: 15000 });

// Lanzador presente y modal oculto al inicio
const launchExists = await page.evaluate(() => !!document.getElementById('setaiLaunch'));
const modalHidden = await page.evaluate(() => getComputedStyle(document.getElementById('setaiModal')).display === 'none');
rec('El lanzador «Generador IA» existe y el modal está oculto', launchExists && modalHidden, 'lanzador=' + launchExists + ' · modal oculto=' + modalHidden);

// Click en el lanzador -> abre el modal
await page.click('#setaiLaunch'); await sleep(200);
const modalOpen = await page.evaluate(() => getComputedStyle(document.getElementById('setaiModal')).display !== 'none');
rec('«Generador IA» abre el recuadro para pedir el set', modalOpen, 'modal visible=' + modalOpen);

// Un chip de ejemplo rellena el texto
await page.click('.setaiEx'); await sleep(100);
const filled = await page.evaluate(() => document.getElementById('setaiText').value.length > 0);
rec('Los ejemplos rellenan el cuadro de texto', filled, 'texto rellenado=' + filled);

// Importar 3 pistas a la biblioteca local
page.on('filechooser', async (fc) => { try { await fc.setFiles(files); } catch (e) {} });
// cerrar modal para poder pulsar Importar (está detrás), luego reabrimos
await page.evaluate(() => window.__audit.setai.close());
await page.click('#importar');
for (let i = 0; i < 50; i++) { const s = await page.evaluate(() => window.__audit?.loaded); if (s && s[0] && s[1]) break; await sleep(400); }
await sleep(2500);

// Pedir el set por TEXTO -> interpreta, arma y mezcla
let added = 0;
for (let i = 0; i < 6; i++) { added = await page.evaluate(() => window.__audit.setai.create('pon 6 pistas que suba de energía')); if (added >= 2) break; await sleep(800); }
rec('La petición en texto arma el set (≥2 pistas)', added >= 2, 'pistas en el set = ' + added);

const isAuto = await page.evaluate(() => window.__audit.autodj.isAuto());
rec('El set pedido por IA queda mezclándose (auto activo)', isAuto === true, 'auto activo=' + isAuto);

let maxPeak = 0;
for (let i = 0; i < 12; i++) { await sleep(500); const pk = await page.evaluate(() => window.__audit.peak()); if (pk > maxPeak) maxPeak = pk; }
rec('El AutoMix reproduce el set real (audio)', maxPeak > 0.01, 'PEAK máx = ' + maxPeak.toFixed(4));

rec('Sin errores JS', errores.length === 0, errores.length ? errores.slice(0, 3).join(' | ') : 'ninguno');

await page.evaluate(() => window.__audit.autodj.stop());
await page.screenshot({ path: path.join(DIR, 'fase3c.png') });
await browser.close();
const okN = out.filter((x) => x.ok).length;
console.log(`\nRESULTADO FASE 3C: ${okN}/${out.length} OK`);
process.exit(okN === out.length ? 0 : 1);

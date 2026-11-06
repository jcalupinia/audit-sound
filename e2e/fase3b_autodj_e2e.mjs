// E2E Fase 3B: «Armar set y mezclar» (DJ Automático) sobre la imagen, motor real.
// Importa 3 pistas (quedan en la biblioteca local), arma un set con el buscador y
// comprueba que el AutoMix del motor REPRODUCE Y MEZCLA solo (PEAK del worklet > 0), que
// el modo auto queda activo, y que «DJ Automático» lo apaga. Los overlays de modo existen.
//
//   ARCHIVE_ENABLED=false WEB_ROOT=<tmp> PORT=8202 node deploy/pro/server.js &
//   node e2e/fase3b_autodj_e2e.mjs <tmp>   (usa cancionA/B/C.wav de <tmp>)
import { chromium } from 'playwright';
import path from 'node:path';

const DIR = process.argv[2];
const BASE = process.env.BASE || 'http://127.0.0.1:8202';
const A = path.join(DIR, 'cancionA.wav');
const B = path.join(DIR, 'cancionB.wav');
const C = path.join(DIR, 'cancionC.wav');
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
await page.waitForFunction(() => window.__audit && document.getElementById('modeAuto'), null, { timeout: 15000 });

// Los overlays de «Modo de operación» existen sobre la imagen
const modes = await page.evaluate(() => ['modeManual', 'modeHibrido', 'modeAuto'].filter((i) => document.getElementById(i)).length);
rec('Los controles de modo (Manual/Híbrido/Automático) existen', modes === 3, modes + '/3 overlays presentes');

// Importar 3 pistas -> quedan en la biblioteca local (analizadas por el copiloto)
page.on('filechooser', async (fc) => { try { await fc.setFiles([A, B, C]); } catch (e) {} });
await page.click('#importar');
let libReady = false;
for (let i = 0; i < 50; i++) { const s = await page.evaluate(() => window.__audit?.loaded); if (s && s[0] && s[1]) { libReady = true; break; } await sleep(400); }
await sleep(2500);   // deja terminar el análisis/guardado de las 3 en la biblioteca
rec('Importa pistas a la biblioteca local', libReady, 'A y B cargados=' + libReady);

// Armar el set (búsqueda vacía -> todas las locales) y arrancar la auto-mezcla
let added = 0;
for (let i = 0; i < 6; i++) { added = await page.evaluate(() => window.__audit.autodj.buildSet('', 10)); if (added >= 2) break; await sleep(800); }
rec('«Armar set» carga ≥2 pistas aptas para mezclar en el AutoMix', added >= 2, 'pistas añadidas al set = ' + added);

// El modo automático queda activo
const isAuto = await page.evaluate(() => window.__audit.autodj.isAuto());
rec('El DJ Automático queda activo', isAuto === true, 'auto activo=' + isAuto);

// El AutoMix REPRODUCE de verdad (PEAK del worklet > 0 sostenido)
let maxPeak = 0;
for (let i = 0; i < 14; i++) { await sleep(500); const pk = await page.evaluate(() => window.__audit.peak()); if (pk > maxPeak) maxPeak = pk; }
rec('El AutoMix reproduce audio real (mezcla sola)', maxPeak > 0.01, 'PEAK máx del AutoMix = ' + maxPeak.toFixed(4));

// Pulsar «DJ Automático» otra vez lo APAGA
await page.click('#modeAuto'); await sleep(400);
const stopped = await page.evaluate(() => window.__audit.autodj.isAuto());
rec('«DJ Automático» (otra vez) apaga el modo', stopped === false, 'auto activo tras apagar=' + stopped);

rec('Sin errores JS', errores.length === 0, errores.length ? errores.slice(0, 3).join(' | ') : 'ninguno');

await page.screenshot({ path: path.join(DIR, 'fase3b.png') });
await browser.close();
const okN = out.filter((x) => x.ok).length;
console.log(`\nRESULTADO FASE 3B: ${okN}/${out.length} OK`);
process.exit(okN === out.length ? 0 : 1);

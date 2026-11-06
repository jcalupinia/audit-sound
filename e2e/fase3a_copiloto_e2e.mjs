// E2E Fase 3A: Copiloto IA sobre la imagen, cableado al motor real.
// Importa 3 pistas (A y B a los platos; las 3 al pool del copiloto), reproduce A y
// comprueba que el copiloto SUGIERE la 3ª (la que no está en ningún plato), muestra la
// tarjeta sobre la imagen, y que «Preparar» la carga al plato libre con el motor real.
//
// Preparación: motor WASM compilado + server COOP/COEP (como console_engine_e2e).
//   ARCHIVE_ENABLED=false WEB_ROOT=<tmp> PORT=8200 node deploy/pro/server.js &
//   node e2e/fase3a_copiloto_e2e.mjs <tmp>   (usa cancionA/B/C.wav de <tmp>)
import { chromium } from 'playwright';
import path from 'node:path';

const DIR = process.argv[2];
const BASE = process.env.BASE || 'http://127.0.0.1:8200';
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

// La tarjeta del copiloto existe sobre la imagen
await page.waitForFunction(() => window.__audit && document.getElementById('copiCard'), null, { timeout: 15000 });
rec('La tarjeta del Copiloto existe sobre la imagen', await page.evaluate(() => !!document.getElementById('copiCard')), '#copiCard presente');

// Importar 3 pistas: A y B a los platos; las 3 al pool del copiloto
page.on('filechooser', async (fc) => { try { await fc.setFiles([A, B, C]); } catch (e) {} });
await page.click('#importar');
let loadedAB = false;
for (let i = 0; i < 50; i++) { const s = await page.evaluate(() => window.__audit?.loaded); if (s && s[0] && s[1]) { loadedAB = true; break; } await sleep(400); }
rec('Importa A y B a los platos', loadedAB, 'A y B cargados=' + loadedAB);

// El pool del copiloto conoce las 3 pistas (análisis bpm/tono/energía sin cargarlas)
let poolSize = 0;
for (let i = 0; i < 40; i++) { poolSize = await page.evaluate(() => window.__audit?.copilot?._copilot?.size() || 0); if (poolSize >= 3) break; await sleep(400); }
rec('El pool del Copiloto conoce las 3 pistas', poolSize >= 3, 'pistas en el pool = ' + poolSize);

// Reproducir A -> el copiloto sugiere la 3ª (la que no está en ningún plato)
await page.click('#playA'); await sleep(300);
let sug = null;
for (let i = 0; i < 40; i++) { sug = await page.evaluate(() => window.__audit?.copilotSuggestion()); if (sug && sug.name) break; await sleep(400); }
const names = await page.evaluate(() => window.__audit.names);
const onDecks = new Set(names.filter(Boolean));
rec('El Copiloto sugiere la pista que NO está en los platos', !!(sug && sug.name) && !onDecks.has(sug.name),
  'sugerencia=' + (sug && sug.name) + ' · en platos=' + JSON.stringify(names));

// La tarjeta muestra la sugerencia y el botón Preparar está habilitado
const cardName = await page.evaluate(() => document.getElementById('copiName').textContent);
const prepEnabled = await page.evaluate(() => !document.getElementById('copiPrep').disabled);
rec('La tarjeta muestra la sugerencia y «Preparar» está activo', !!(sug && cardName === sug.name) && prepEnabled,
  'tarjeta="' + cardName + '" · preparar activo=' + prepEnabled);

// Pulsar «Preparar» -> carga la sugerencia en el plato libre (B, que no suena)
const sugName = sug && sug.name;
await page.click('#copiPrep');
let prepared = false;
for (let i = 0; i < 40; i++) { const nm = await page.evaluate(() => window.__audit.names); if (nm[1] === sugName) { prepared = true; break; } await sleep(400); }
rec('«Preparar» carga la sugerencia en el plato libre', prepared, 'plato B = "' + (await page.evaluate(() => window.__audit.names))[1] + '" (esperado "' + sugName + '")');

// El plato B quedó realmente cargado en el motor
const bLoaded = await page.evaluate(() => window.__audit.loaded[1]);
rec('El plato libre quedó cargado en el motor', bLoaded, 'B cargado=' + bLoaded);

rec('Sin errores JS', errores.length === 0, errores.length ? errores.slice(0, 3).join(' | ') : 'ninguno');

await page.screenshot({ path: path.join(DIR, 'fase3a.png') });
await browser.close();
const okN = out.filter((x) => x.ok).length;
console.log(`\nRESULTADO FASE 3A: ${okN}/${out.length} OK`);
process.exit(okN === out.length ? 0 : 1);

// E2E Biblioteca REAL: al importar, TU música aparece en el panel de biblioteca (no las
// miniaturas decorativas) y se puede cargar al plato desde ahí.
//
//   ARCHIVE_ENABLED=false WEB_ROOT=<tmp> PORT=8205 node deploy/pro/server.js &
//   node e2e/fase_biblioteca_e2e.mjs <tmp>   (usa cancionA/B/C.wav de <tmp>)
import { chromium } from 'playwright';
import path from 'node:path';

const DIR = process.argv[2];
const BASE = process.env.BASE || 'http://127.0.0.1:8205';
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
await page.waitForFunction(() => window.__audit && document.getElementById('libPanel'), null, { timeout: 15000 });

// El panel existe y arranca vacío (con el aviso de importar)
const emptyMsg = await page.evaluate(() => document.getElementById('libPanel').textContent);
rec('El panel de biblioteca real existe y arranca vacío con instrucción', /importar/i.test(emptyMsg), 'texto inicial: ' + emptyMsg.slice(0, 48) + '…');

// Importar 3 pistas -> deben aparecer en el panel (tu música, no las miniaturas)
page.on('filechooser', async (fc) => { try { await fc.setFiles(files); } catch (e) {} });
await page.click('#importar');
let count = 0;
for (let i = 0; i < 50; i++) { count = await page.evaluate(() => window.__audit?.libpanel?.count() || 0); if (count >= 3) break; await sleep(400); }
rec('Tu música importada aparece en la biblioteca', count >= 3, 'pistas en el panel = ' + count);

// Los nombres reales se ven en el panel
const names = await page.evaluate(() => Array.from(document.querySelectorAll('#libPanel div[title]')).map((e) => e.getAttribute('title')));
rec('El panel muestra los nombres reales de las pistas', names.includes('cancionA.wav') && names.includes('cancionC.wav'), JSON.stringify(names));

// Cargar desde el panel: pulsar ▶B de la primera pista -> el plato B queda cargado con ella
await page.click('#libPanel div[title] ~ button:nth-of-type(2), #libPanel button:nth-of-type(2)');
let loadedName = '';
for (let i = 0; i < 40; i++) { const nm = await page.evaluate(() => window.__audit.names); if (nm[1]) { loadedName = nm[1]; break; } await sleep(400); }
rec('Cargar una pista de la biblioteca al plato (▶B)', !!loadedName, 'plato B = "' + loadedName + '"');

// Arrastrar y soltar: arrastrar una fila al plato A -> el plato A queda cargado con ella
const nameEl = await page.$('#libPanel div[title]');
const dragTitle = await nameEl.getAttribute('title');
const box = await nameEl.boundingBox();
const fb = await page.evaluate(() => { const r = document.getElementById('frame').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(fb.x + fb.w * 0.18, fb.y + fb.h * 0.60, { steps: 10 });   // sobre el plato A
await page.mouse.up();
let aName = '';
for (let i = 0; i < 40; i++) { const nm = await page.evaluate(() => window.__audit.names); if (nm[0] === dragTitle) { aName = nm[0]; break; } await sleep(400); }
rec('Arrastrar una pista de la biblioteca al plato A la carga', aName === dragTitle, 'arrastrada="' + dragTitle + '" → plato A="' + aName + '"');

rec('Sin errores JS', errores.length === 0, errores.length ? errores.slice(0, 3).join(' | ') : 'ninguno');

await page.screenshot({ path: path.join(DIR, 'biblioteca.png') });
await browser.close();
const okN = out.filter((x) => x.ok).length;
console.log(`\nRESULTADO BIBLIOTECA: ${okN}/${out.length} OK`);
process.exit(okN === out.length ? 0 : 1);

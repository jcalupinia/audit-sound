// E2E Fase 1: buscador de la consola. Importa (guarda en biblioteca local), busca,
// carga un resultado a un deck con el motor real y comprueba que suena.
import { chromium } from 'playwright';
import path from 'node:path';

const DIR = process.argv[2];
const BASE = process.env.BASE || 'http://127.0.0.1:8194';
const A = path.join(DIR, 'cancionA.wav');
const out = [];
const rec = (n, ok, d) => { out.push({ n, ok, d }); console.log((ok ? 'OK  ' : 'FALLA ') + n + ' — ' + d); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('auditsound.cc.token', 'test'); localStorage.setItem('auditsound.cc.user', 'dj@test'); } catch (e) {} });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', e => errores.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('[auditsound]')) errores.push('console.error: ' + m.text()); });

await page.goto(BASE + '/console.html', { waitUntil: 'networkidle' });

// La barra de búsqueda existe sobre la imagen
const hasSearch = await page.evaluate(() => !!document.getElementById('buscar') && !!document.getElementById('resultados'));
rec('La barra de búsqueda existe en la consola', hasSearch, 'input #buscar + panel #resultados presentes');

// Importar 1 pista -> carga A + la guarda en la biblioteca local (persistencia)
page.on('filechooser', async fc => { try { await fc.setFiles([A]); } catch (e) {} });
await page.click('#importar');
let loadedA = false;
for (let i = 0; i < 40; i++) { const s = await page.evaluate(() => window.__audit?.loaded); if (s && s[0]) { loadedA = true; break; } await sleep(400); }
rec('Importar carga A y arranca el motor', loadedA, 'deck A cargado=' + loadedA);

// ¿quedó guardada en la biblioteca local?
await page.evaluate(() => window.__audit.refreshLocal());
const libCount = await page.evaluate(async () => { try { return (await window.__audit.lib.listTracks()).length; } catch (e) { return -1; } });
rec('La pista importada persiste en la biblioteca local', libCount >= 1, 'pistas en biblioteca = ' + libCount);

// Buscar en la barra -> el panel aparece con el resultado local
await page.fill('#buscar', 'cancion');
await page.evaluate(() => document.getElementById('buscar').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
let rows = 0;
for (let i = 0; i < 20; i++) { rows = await page.evaluate(() => document.querySelectorAll('#resultados .rrow').length); const vis = await page.evaluate(() => getComputedStyle(document.getElementById('resultados')).display); if (rows > 0 && vis !== 'none') break; await sleep(300); }
const panelVisible = await page.evaluate(() => getComputedStyle(document.getElementById('resultados')).display !== 'none');
rec('El buscador muestra resultados (fuente Local)', rows >= 1 && panelVisible, `filas=${rows}, panel visible=${panelVisible}`);
const srcTxt = await page.evaluate(() => { const r = document.querySelector('#resultados .rrow .rs'); return r ? r.textContent : ''; });
rec('El resultado indica su fuente y disponibilidad', /Local/.test(srcTxt) && /mezclar/.test(srcTxt), `"${srcTxt}"`);

// Cargar el resultado al deck B con el botón ▶B del panel
const btnB = await page.$('#resultados .rrow .racts button:nth-child(2)');
await btnB.click();
let loadedB = false;
for (let i = 0; i < 40; i++) { const s = await page.evaluate(() => window.__audit?.loaded); if (s && s[1]) { loadedB = true; break; } await sleep(400); }
rec('Cargar desde el buscador al deck B', loadedB, 'deck B cargado desde resultado=' + loadedB);

// Reproducir B -> suena de verdad
await page.click('#playB'); await sleep(1200);
const peak = await page.evaluate(() => window.__audit.peak());
rec('El deck cargado desde el buscador suena', peak > 0.001, `PEAK del worklet = ${peak.toFixed(4)}`);

rec('Sin errores JS', errores.length === 0, errores.length ? errores.slice(0, 3).join(' | ') : 'ninguno');

await page.screenshot({ path: path.join(DIR, 'fase1.png') });
await browser.close();
const okN = out.filter(x => x.ok).length;
console.log(`\nRESULTADO FASE 1: ${okN}/${out.length} OK`);
process.exit(okN === out.length ? 0 : 1);

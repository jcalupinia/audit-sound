// E2E Fase 2: controles de plato sobre la imagen cableados al motor real.
// Prueba fuerte: bajar todo el EQ silencia el audio del motor (PEAK cae).
import { chromium } from 'playwright';
import path from 'node:path';

const DIR = process.argv[2];
const BASE = process.env.BASE || 'http://127.0.0.1:8197';
const A = path.join(DIR, 'cancionA.wav');
const out = [];
const rec = (n, ok, d) => { out.push({ n, ok, d }); console.log((ok ? 'OK  ' : 'FALLA ') + n + ' — ' + d); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('auditsound.cc.token', 'test'); } catch (e) {} });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', e => errores.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('[auditsound]')) errores.push('console.error: ' + m.text()); });

await page.goto(BASE + '/console.html', { waitUntil: 'networkidle' });

// Todos los controles de Fase 2 existen en el DOM
const ids = ['eqHiA','eqMidA','eqLowA','eqHiB','eqMidB','eqLowB','syncA','syncB','lockA','lockB',
  'loopInA','loopOutA','reloopA','loopBeatsA','loopInB','loopOutB','bjFwdA','bjBackA',
  'hc1A','hc2A','hc3A','hc4A','hc1B','hc2B','hc3B','hc4B'];
const present = await page.evaluate((ids) => ids.filter(i => document.getElementById(i)).length, ids);
rec('Los controles de plato existen sobre la imagen', present === ids.length, present + '/' + ids.length + ' controles presentes');

// Regresión de alineación (reporte de la extensión 2026-11-06): el bloque del plato A
// estaba corrido a la derecha, sobre el EQ/crossfader central. Verificar que: (a) el
// bloque del plato A queda a la IZQUIERDA del EQ central, y (b) A y B están separados
// ~50% del ancho (centros de syncA/syncB y hc1A/hc1B). Centros en fracción del #frame.
const geo = await page.evaluate(() => {
  const f = document.getElementById('frame').getBoundingClientRect();
  const cx = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return (r.left + r.width / 2 - f.left) / f.width; };
  return { syncA: cx('syncA'), syncB: cx('syncB'), eq: cx('eqHiA'), hc1A: cx('hc1A'), hc1B: cx('hc1B') };
});
const sep = geo.syncB - geo.syncA, sepHc = geo.hc1B - geo.hc1A;
rec('Alineación: el bloque del plato A está a la izquierda del EQ central',
  geo.syncA < geo.eq && geo.syncB > geo.eq, `syncA=${geo.syncA.toFixed(3)} eq=${geo.eq.toFixed(3)} syncB=${geo.syncB.toFixed(3)}`);
rec('Alineación: platos A y B separados ~50% (sync y hotcue)',
  Math.abs(sep - 0.5) < 0.03 && Math.abs(sepHc - 0.5) < 0.03, `sep sync=${sep.toFixed(3)} · sep hc1=${sepHc.toFixed(3)}`);

// Arrancar motor + cargar A
page.on('filechooser', async fc => { try { await fc.setFiles([A]); } catch (e) {} });
await page.click('#importar');
let loadedA = false;
for (let i = 0; i < 40; i++) { const s = await page.evaluate(() => window.__audit?.loaded); if (s && s[0]) { loadedA = true; break; } await sleep(400); }
await page.click('#playA'); await sleep(1000);
// medir nivel base en una ventana limpia: resetear, esperar, leer
await page.evaluate(() => window.__audit.peak());
await sleep(600);
const base = await page.evaluate(() => window.__audit.peak());
rec('Plato A cargado y sonando (base)', loadedA && base > 0.01, 'PEAK base = ' + base.toFixed(4));

// PRUEBA FUERTE: bajar HI+MID+LOW de A a -12 dB (corte) -> silencio
await page.evaluate(() => { for (const id of ['eqLowA','eqMidA','eqHiA']) { const el = document.getElementById(id); el.value = '-12'; el.dispatchEvent(new Event('input', { bubbles: true })); } });
await sleep(800);                                   // deja que el ring se vacíe del audio previo
await page.evaluate(() => window.__audit.peak());   // resetear la medición
await sleep(600);                                   // ventana de medición ya con EQ en corte
const killed = await page.evaluate(() => window.__audit.peak());
rec('EQ: bajar HI+MID+LOW a -12 dB SILENCIA el motor', killed < base * 0.5, `PEAK con EQ en corte = ${killed.toFixed(4)} (base ${base.toFixed(4)})`);
// restaurar EQ plano (0 dB)
await page.evaluate(() => { for (const id of ['eqLowA','eqMidA','eqHiA']) { const el = document.getElementById(id); el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); } });
await sleep(800);
await page.evaluate(() => window.__audit.peak());
await sleep(600);
const restored = await page.evaluate(() => window.__audit.peak());
rec('EQ: restaurar a plano devuelve el audio', restored > base * 0.5, `PEAK restaurado = ${restored.toFixed(4)}`);

// Keylock, SYNC, loop, beatjump, hotcue: operan el motor sin romper el audio
await page.click('#lockA'); await sleep(200);
rec('Keylock opera sin romper el audio', (await page.evaluate(() => window.__audit.peak())) > 0.005, 'ok');
await page.click('#syncA'); await sleep(200);
rec('SYNC opera sin romper el audio', (await page.evaluate(() => window.__audit.peak())) > 0.005, 'ok');
await page.click('#loopInA'); await sleep(500);
const pLoop = await page.evaluate(() => window.__audit.peak());
await page.click('#loopOutA');
rec('Loop IN mantiene el audio sonando', pLoop > 0.005, `PEAK con loop = ${pLoop.toFixed(4)}`);
await page.click('#bjFwdA'); await sleep(200);
rec('Beatjump opera sin romper el audio', (await page.evaluate(() => window.__audit.peak())) > 0.005, 'ok');
// Hotcue: fijar y saltar
await page.click('#hc1A'); await sleep(600); await page.click('#hc1A'); await sleep(300);
rec('Hotcue fija y salta sin romper el audio', (await page.evaluate(() => window.__audit.peak())) > 0.005, 'ok');

rec('Sin errores JS', errores.length === 0, errores.length ? errores.slice(0, 3).join(' | ') : 'ninguno');

await page.screenshot({ path: path.join(DIR, 'fase2.png') });
await browser.close();
const okN = out.filter(x => x.ok).length;
console.log(`\nRESULTADO FASE 2: ${okN}/${out.length} OK`);
process.exit(okN === out.length ? 0 : 1);

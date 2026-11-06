// E2E Fase 2b: capa de feedback (ondas reales, cabezal/tiempo/BPM, VU) + estado visual.
import { chromium } from 'playwright';
import path from 'node:path';
const DIR = process.argv[2];
const BASE = process.env.BASE || 'http://127.0.0.1:8198';
const A = path.join(DIR, 'cancionA.wav');
const out = []; const rec = (n, ok, d) => { out.push({ n, ok, d }); console.log((ok ? 'OK  ' : 'FALLA ') + n + ' — ' + d); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('auditsound.cc.token', 'test'); } catch (e) {} });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', e => errores.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('[auditsound]')) errores.push('console.error: ' + m.text()); });
await page.goto(BASE + '/console.html', { waitUntil: 'networkidle' });

rec('Canvas de onda y VU sobre la imagen', await page.evaluate(() => !!document.getElementById('fbWaveA') && !!document.getElementById('fbWaveB') && !!document.getElementById('fbVu')), 'fbWaveA/B + fbVu presentes');

page.on('filechooser', async fc => { try { await fc.setFiles([A]); } catch (e) {} });
await page.click('#importar');
let loaded = false;
for (let i = 0; i < 40; i++) { if ((await page.evaluate(() => window.__audit?.loaded))?.[0]) { loaded = true; break; } await sleep(400); }
await page.click('#playA'); await sleep(1500);

// La onda real llegó (bins > 0) y el BPM/posición avanzan
const waveBins = await page.evaluate(() => window.__audit.waves[0]);
rec('La forma de onda real se recibe para dibujar', waveBins > 0, 'bins de la onda A = ' + waveBins);
const bpm = await page.evaluate(() => window.__audit.bpm[0]);
rec('BPM real disponible para mostrar', bpm > 0, 'BPM A = ' + Math.round(bpm));
const p1 = await page.evaluate(() => window.__audit.posn[0]); await sleep(800); const p2 = await page.evaluate(() => window.__audit.posn[0]);
rec('La posición (cabezal/tiempo) avanza', p2 > p1, `pos ${p1.toFixed(2)}s → ${p2.toFixed(2)}s`);
rec('VU en vivo con nivel (hay audio)', (await page.evaluate(() => window.__audit.peak())) > 0.001, 'vu = ' + (await page.evaluate(() => window.__audit.peak())).toFixed(4));
// El canvas pintó algo (no está en blanco)
const painted = await page.evaluate(() => { const cv = document.getElementById('fbWaveA'); const ctx = cv.getContext('2d'); const d = ctx.getImageData(0, 0, Math.min(40, cv.width), Math.min(20, cv.height)).data; let nz = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 20) nz++; return nz; });
rec('El canvas de onda está pintado (no en blanco)', painted > 0, 'píxeles no vacíos = ' + painted);

// Estado visual: hotcue fijado -> clase 'on'; loop IN -> 'on' y OUT -> quita; keylock -> 'on'
await page.click('#hc1A'); await sleep(150);
rec('Hotcue fijado muestra anillo (clase on)', await page.evaluate(() => document.getElementById('hc1A').classList.contains('on')), 'hc1A.on');
await page.click('#loopInA'); await sleep(150);
const loopOn = await page.evaluate(() => document.getElementById('loopInA').classList.contains('on'));
await page.click('#loopOutA'); await sleep(150);
const loopOff = await page.evaluate(() => !document.getElementById('loopInA').classList.contains('on'));
rec('Loop activo/inactivo se refleja visualmente', loopOn && loopOff, 'IN→on=' + loopOn + ', OUT→off=' + loopOff);
await page.click('#lockA'); await sleep(150);
rec('Keylock ON muestra anillo', await page.evaluate(() => document.getElementById('lockA').classList.contains('on')), 'lockA.on');

rec('Sin errores JS', errores.length === 0, errores.length ? errores.slice(0, 3).join(' | ') : 'ninguno');

await page.screenshot({ path: path.join(DIR, 'fase2b.png') });
await browser.close();
const okN = out.filter(x => x.ok).length;
console.log(`\nRESULTADO FASE 2b: ${okN}/${out.length} OK`);
process.exit(okN === out.length ? 0 : 1);

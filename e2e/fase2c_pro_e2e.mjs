// E2E Fase 2c: beatgrid, pitch, jog (scrub) y cue profesional.
import { chromium } from 'playwright';
import path from 'node:path';
const DIR = process.argv[2];
const BASE = process.env.BASE || 'http://127.0.0.1:8199';
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

rec('Pitch y jog existen sobre la imagen', await page.evaluate(() => ['pitchA','pitchB','jogA','jogB'].every(i => document.getElementById(i))), 'pitchA/B + jogA/B');

page.on('filechooser', async fc => { try { await fc.setFiles([A]); } catch (e) {} });
await page.click('#importar');
let loaded = false; for (let i = 0; i < 40; i++) { if ((await page.evaluate(() => window.__audit?.loaded))?.[0]) { loaded = true; break; } await sleep(400); }
await page.click('#playA'); await sleep(1500);

// Beatgrid: hay BPM y beatOffset, y el canvas dibuja líneas doradas de compás
const bg = await page.evaluate(() => ({ bpm: window.__audit.bpm[0], off: window.__audit.beatOffset[0] }));
const gold = await page.evaluate(() => { const cv = document.getElementById('fbWaveA'); const ctx = cv.getContext('2d'); const d = ctx.getImageData(0, 0, cv.width, cv.height).data; let g = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 150 && d[i+1] > 110 && d[i+1] < 200 && d[i+2] < 110) g++; } return g; });
rec('Beatgrid: BPM/offset disponibles y líneas de compás dibujadas', bg.bpm > 0 && gold > 0, `bpm=${Math.round(bg.bpm)}, offset=${bg.off.toFixed(3)}, píxeles dorados=${gold}`);

// Pitch: a +8% el cabezal avanza más rápido que a 0%
await page.evaluate(() => { const p = document.getElementById('pitchA'); p.value = '0'; p.dispatchEvent(new Event('input', { bubbles: true })); });
let a = await page.evaluate(() => window.__audit.posn[0]); await sleep(1000); let b = await page.evaluate(() => window.__audit.posn[0]); const dNorm = b - a;
await page.evaluate(() => { const p = document.getElementById('pitchA'); p.value = '8'; p.dispatchEvent(new Event('input', { bubbles: true })); });
a = await page.evaluate(() => window.__audit.posn[0]); await sleep(1000); b = await page.evaluate(() => window.__audit.posn[0]); const dFast = b - a;
rec('Pitch +8% acelera la reproducción', dFast > dNorm * 1.04, `avance normal=${dNorm.toFixed(3)}s/s · a +8%=${dFast.toFixed(3)}s/s`);
await page.evaluate(() => { const p = document.getElementById('pitchA'); p.value = '0'; p.dispatchEvent(new Event('input', { bubbles: true })); });

// Jog (scrub): arrastrar sobre el plato mueve el cabezal
const posBefore = await page.evaluate(() => window.__audit.posn[0]);
const box = await page.locator('#jogA').boundingBox();
await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 8 });
await page.mouse.up();
await sleep(500);
const posAfter = await page.evaluate(() => window.__audit.posn[0]);
rec('Jog (scrub): arrastrar mueve el cabezal', Math.abs(posAfter - posBefore) > 1.5, `pos ${posBefore.toFixed(2)}s → ${posAfter.toFixed(2)}s`);

// CUE profesional: tap mientras suena -> vuelve al cue (≈0) y pausa
// Asegurar que A está reproduciendo SIN togglear por error.
if (!(await page.evaluate(() => window.__audit.playing[0]))) { await page.click('#playA'); }
await sleep(400);
// tap de cue (pointerdown+up)
const cueBox = await page.locator('#cueA').boundingBox();
await page.mouse.move(cueBox.x + cueBox.width / 2, cueBox.y + cueBox.height / 2);
await page.mouse.down(); await page.mouse.up();
await sleep(500);
const afterCue = await page.evaluate(() => ({ pos: window.__audit.posn[0], playing: window.__audit.playing[0] }));
rec('CUE (tap) vuelve al punto de cue y pausa', afterCue.pos < 1.2 && afterCue.playing === false, `pos=${afterCue.pos.toFixed(2)}s, playing=${afterCue.playing}`);

rec('Sin errores JS', errores.length === 0, errores.length ? errores.slice(0, 3).join(' | ') : 'ninguno');

await page.screenshot({ path: path.join(DIR, 'fase2c.png') });
await browser.close();
const okN = out.filter(x => x.ok).length;
console.log(`\nRESULTADO FASE 2c: ${okN}/${out.length} OK`);
process.exit(okN === out.length ? 0 : 1);

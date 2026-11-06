// E2E PWA: instalabilidad + service worker SIN romper el aislamiento de origen del motor.
// Verifica: manifest válido; el SW se registra y controla la página; con el SW activo la
// página SIGUE aislada (crossOriginIsolated=true → SharedArrayBuffer) y el motor REPRODUCE
// audio real; y la consola abre SIN CONEXIÓN (shell desde caché).
//
//   ARCHIVE_ENABLED=false WEB_ROOT=<tmp> PORT=8204 node deploy/pro/server.js &
//   node e2e/fase_pwa_e2e.mjs <tmp>   (usa cancionA.wav de <tmp>)
import { chromium } from 'playwright';
import path from 'node:path';

const DIR = process.argv[2];
const BASE = process.env.BASE || 'http://127.0.0.1:8204';
const A = path.join(DIR, 'cancionA.wav');
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

// 1) Manifest enlazado y válido
const man = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return null;
  try { const r = await fetch(link.href); const ct = r.headers.get('content-type') || ''; const j = await r.json(); return { ct, name: j.name, icons: (j.icons || []).length, display: j.display }; } catch (e) { return { err: String(e) }; }
});
rec('El manifest está enlazado y es válido', !!(man && man.name === 'AUDIT SOUND' && man.icons >= 2 && /manifest/.test(man.ct)),
  JSON.stringify(man));

// 2) El service worker se registra y queda activo
let swActive = false;
for (let i = 0; i < 30; i++) { swActive = await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true).catch(() => false)); if (swActive) break; await sleep(300); }
rec('El service worker se registra y activa', swActive === true, 'sw activo=' + swActive);

// 3) Recargar: el SW controla la página Y sigue aislada (SharedArrayBuffer intacto)
await page.reload({ waitUntil: 'networkidle' });
await sleep(400);
const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
const isolated = await page.evaluate(() => self.crossOriginIsolated === true);
rec('Con el SW activo la página sigue controlada y AISLADA (SharedArrayBuffer)', controlled && isolated,
  'controlada=' + controlled + ' · crossOriginIsolated=' + isolated);

// 4) El motor SIGUE sonando bajo el service worker (no rompió el aislamiento)
await page.waitForFunction(() => window.__audit, null, { timeout: 15000 });
page.on('filechooser', async (fc) => { try { await fc.setFiles([A]); } catch (e) {} });
await page.click('#importar');
let loaded = false;
for (let i = 0; i < 40; i++) { const s = await page.evaluate(() => window.__audit?.loaded); if (s && s[0]) { loaded = true; break; } await sleep(400); }
await page.click('#playA'); await sleep(1200);
const peak = await page.evaluate(() => window.__audit.peak());
rec('El motor reproduce audio real con el SW activo', loaded && peak > 0.001, 'cargado=' + loaded + ' · PEAK=' + peak.toFixed(4));

// 5) SIN CONEXIÓN: la consola (shell) abre desde la caché del SW
await ctx.setOffline(true);
let offlineOk = false, offlineIso = false;
try {
  await page.goto(BASE + '/console.html', { waitUntil: 'domcontentloaded', timeout: 15000 });
  offlineOk = await page.evaluate(() => !!document.getElementById('frame') && /AUDIT SOUND/.test(document.title));
  offlineIso = await page.evaluate(() => self.crossOriginIsolated === true);
} catch (e) { errores.push('offline nav: ' + e.message); }
await ctx.setOffline(false);
rec('La consola abre SIN CONEXIÓN (shell desde caché, sigue aislada)', offlineOk && offlineIso,
  'shell=' + offlineOk + ' · aislada=' + offlineIso);

rec('Sin errores JS', errores.length === 0, errores.length ? errores.slice(0, 3).join(' | ') : 'ninguno');

await browser.close();
const okN = out.filter((x) => x.ok).length;
console.log(`\nRESULTADO PWA: ${okN}/${out.length} OK`);
process.exit(okN === out.length ? 0 : 1);

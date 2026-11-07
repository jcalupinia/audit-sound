// E2E · Frontend Pro v0.6 — P0.3: BÚSQUEDA de música de uso libre cableada al v0.6.
// Reutiliza search.js/openmusic.js/archive.js. Dos partes:
//  A) Comportamiento REAL con las fuentes deshabilitadas (sandbox): la búsqueda se maneja
//     con gracia (mensaje claro, sin excepción) — es el camino real end-to-end.
//  B) Pipeline COMPLETO con un proveedor de PRUEBA inyectado (window.__ASLive.searchAll /
//     searchBytesOf): buscar → render de resultados → cargar al plato → el MOTOR reproduce.
//     (Los proveedores reales alimentan este mismo pipeline en producción.)
//
// Uso: BASE=http://127.0.0.1:8194 node e2e/fase_v06_busqueda_e2e.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8194';
const out = [];
const rec = (n, ok, d) => { out.push({ n, ok, d }); console.log((ok ? 'OK  ' : 'FALLA ') + n + ' — ' + d); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext()).newPage();
const errores = [];
page.on('pageerror', e => errores.push(String(e)));
page.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!t.includes('[auditsound]')) errores.push('console.error: ' + t); } });

async function entrarConMotor() {
  await page.click('[data-action="guest"]');
  await page.waitForSelector('[data-action="navigate"][data-page="consola"]');
  await page.click('[data-action="navigate"][data-page="consola"]');
  await page.waitForSelector('[data-action="engine-live"]');
  await page.click('[data-action="engine-live"]');
  for (let i = 0; i < 60; i++) { if (await page.evaluate(() => window.AuditSoundQA.live().ready === true)) break; await sleep(250); }
}
const buscar = async (q) => {
  await page.fill('form[data-form="websearch"] input[name="q"]', q);
  await page.click('form[data-form="websearch"] button[type="submit"]');
};

await page.goto(BASE + '/v06/', { waitUntil: 'networkidle' });
await entrarConMotor();

// El puente expone la búsqueda
const api = await page.evaluate(() => typeof window.__ASLive.searchAll === 'function' && typeof window.__ASLive.searchProviders === 'function');
rec('Puente expone la búsqueda (searchAll/providers)', api, 'disponible=' + api);

await page.click('[data-action="navigate"][data-page="biblioteca"]');
await page.waitForSelector('form[data-form="websearch"]');

// --- Parte A: fuentes reales deshabilitadas en el sandbox → manejo con gracia ---
await buscar('jazz piano');
let msgA = '';
for (let i = 0; i < 20; i++) { msgA = await page.evaluate(() => { const d = document.querySelector('form[data-form="websearch"]')?.parentElement?.querySelector('.small'); return d ? d.textContent : ''; }); if (msgA && !/Buscando/.test(msgA)) break; await sleep(250); }
rec('Búsqueda real manejada con gracia (sin crash)', /fuentes|resultado|Error|sin:/i.test(msgA), msgA.slice(0, 120));

// --- Parte B: proveedor de PRUEBA para verificar el pipeline completo ---
await page.evaluate(() => {
  window.__ASLive.searchAll = async () => ({
    results: [{ source: 'libre', id: 'stub1', title: 'Pista Stub', artist: 'Tester', sourceLabel: 'Libre', availability: 'mezclar', duration: 6, filename: 'Pista Stub', _raw: { audio: 'stub' } }],
    errors: [], bySource: { libre: 1 }, query: 'stub',
  });
  window.__ASLive.searchBytesOf = async () => (await fetch('/cancionA.wav')).arrayBuffer();
});
await buscar('stub');
let card = false;
for (let i = 0; i < 20; i++) { card = await page.evaluate(() => !!Array.from(document.querySelectorAll('article.asset h3')).find(h => h.textContent.includes('Pista Stub'))); if (card) break; await sleep(200); }
rec('Resultados de búsqueda se renderizan', card, card ? 'tarjeta «Pista Stub» visible' : 'no apareció');

// Cargar el resultado al Deck A (trae bytes del proveedor de prueba → motor)
await page.locator('article.asset', { hasText: 'Pista Stub' }).locator('[data-action="web-load"][data-deck="A"]').first().click();
let loaded = false;
for (let i = 0; i < 40; i++) { if (await page.evaluate(() => window.AuditSoundQA.live().dur.A > 0)) { loaded = true; break; } await sleep(250); }
rec('El resultado se carga en el motor (dur.A>0)', loaded, 'dur.A=' + (await page.evaluate(() => window.AuditSoundQA.live().dur.A)).toFixed(2));

// Reproducir por el motor
await page.click('[data-action="navigate"][data-page="consola"]');
await page.click('button[data-action="deck-play"][data-deck="A"]');
await sleep(2000);
const st = await page.evaluate(() => window.AuditSoundQA.live());
rec('Reproduce el resultado buscado por el motor (pos avanza)', st.dur.A > 0.5 && st.pos.A > 0.05, `pos.A=${st.pos.A?.toFixed(3)} dur.A=${st.dur.A?.toFixed(2)}`);

// Quedó en la biblioteca (persistido + copiloto)
const inLib = await page.evaluate(async () => ({ lib: (await window.__ASLive.lib.listTracks()).some(t => t.id === 'web-libre-stub1'), co: window.__ASLive.copilot.size() >= 1 }));
rec('El resultado buscado entra a la biblioteca/copiloto', inLib.lib && inLib.co, JSON.stringify(inLib));

rec('Sin errores JS no capturados', errores.length === 0, errores.length ? errores.slice(0, 3).join(' | ') : 'ninguno');

await browser.close();
const ok = out.filter(o => o.ok).length;
console.log(`\n${ok}/${out.length} verificaciones OK`);
process.exit(ok === out.length ? 0 : 1);

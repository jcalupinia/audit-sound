// E2E · Frontend Pro v0.6 — P0.2: BIBLIOTECA + análisis reales, PERSISTENCIA (IndexedDB)
// y COPILOTO real (recomendador Camelot/BPM/energía). Reutiliza los módulos ya probados
// library.js y copilot.js del motor. Mide window.__ASLive.copilot / .lib (no inventa nada).
//
// Uso: BASE=http://127.0.0.1:8194 node e2e/fase_v06_biblioteca_copiloto_e2e.mjs <dir-wavs>
import { chromium } from 'playwright';
import path from 'node:path';

const DIR = process.argv[2];
const BASE = process.env.BASE || 'http://127.0.0.1:8194';
const A = path.join(DIR, 'cancionA.wav');
const B = path.join(DIR, 'cancionB.wav');
const out = [];
const rec = (n, ok, d) => { out.push({ n, ok, d }); console.log((ok ? 'OK  ' : 'FALLA ') + n + ' — ' + d); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext();
const page = await ctx.newPage();
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

await page.goto(BASE + '/v06/', { waitUntil: 'networkidle' });
await entrarConMotor();

// Importar 2 WAV reales (deck A y B) → dispara análisis (motor) + persistencia + copiloto
await page.setInputFiles('input[data-file="audio-A"]', A);
await sleep(500);
await page.setInputFiles('input[data-file="audio-B"]', B);

// Esperar a que el análisis+persistencia terminen (biblioteca IndexedDB y copiloto)
let libN = 0, coN = 0;
for (let i = 0; i < 60; i++) {
  const r = await page.evaluate(async () => ({ lib: (await window.__ASLive.lib.listTracks()).length, co: window.__ASLive.copilot.size() }));
  libN = r.lib; coN = r.co; if (libN >= 2 && coN >= 2) break; await sleep(250);
}
rec('Biblioteca real persistida en IndexedDB', libN >= 2, 'tracks en IndexedDB = ' + libN);
rec('Copiloto cargó las pistas (Camelot/BPM/energía)', coN >= 2, 'copilot.size() = ' + coN);

// Metadatos reales analizados por el motor (bpm > 0 y clave presente)
const meta = await page.evaluate(async () => (await window.__ASLive.lib.listTracks()).map(t => ({ bpm: t.bpm, key: t.key })));
rec('Metadatos analizados por el motor (BPM>0)', meta.every(m => m.bpm > 0), JSON.stringify(meta));

// Copiloto REAL: clic en una acción rápida → respuesta con recomendación (no [MOCK])
await page.click('[data-action="agent-suggestion"]');
await sleep(400);
const chat = await page.evaluate(() => document.getElementById('compact-chat')?.innerText || '');
const real = /sugerida|Top 3|%/.test(chat) && !chat.includes('[MOCK]');
rec('Copiloto da recomendación real (no MOCK)', real, chat.slice(-160).replace(/\n/g, ' '));

// PERSISTENCIA tras recargar: se pierde la memoria (mediaFiles), IndexedDB NO.
await page.reload({ waitUntil: 'networkidle' });
await entrarConMotor();
const libN2 = await page.evaluate(async () => (await window.__ASLive.lib.listTracks()).length);
rec('La biblioteca sobrevive a la recarga', libN2 >= 2, 'tracks tras recarga = ' + libN2);

// Cargar una pista persistida (bytes desde IndexedDB) al Deck A y reproducir por el motor
await page.click('[data-action="navigate"][data-page="biblioteca"]');
await page.waitForSelector('[data-action="load-deck"][data-deck="A"]');
// Cargar la pista REAL persistida (no una de las de demostración): botón "A" de su tarjeta
await page.locator('article.asset', { hasText: 'cancionA' })
  .locator('[data-action="load-deck"][data-deck="A"]').first().click();
// esperar a que el motor termine de decodificar los bytes de IndexedDB (dur.A > 0)
let loaded = false;
for (let i = 0; i < 40; i++) { if (await page.evaluate(() => window.AuditSoundQA.live().dur.A > 0)) { loaded = true; break; } await sleep(250); }
await page.click('[data-action="navigate"][data-page="consola"]');
await page.click('button[data-action="deck-play"][data-deck="A"]');
await sleep(2000);
const st = await page.evaluate(() => window.AuditSoundQA.live());
rec('Reproduce desde IndexedDB por el motor (pos avanza)', st.dur.A > 0.5 && st.pos.A > 0.05, `pos.A=${st.pos.A?.toFixed(3)} dur.A=${st.dur.A?.toFixed(2)}`);

rec('Sin errores JS no capturados', errores.length === 0, errores.length ? errores.slice(0, 3).join(' | ') : 'ninguno');

await browser.close();
const ok = out.filter(o => o.ok).length;
console.log(`\n${ok}/${out.length} verificaciones OK`);
process.exit(ok === out.length ? 0 : 1);

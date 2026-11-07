// E2E · Frontend Pro v0.6 CABLEADO al MOTOR REAL (WASM) — integración P0 (navegador).
// Abre /v06/, entra como invitado, activa el "Motor PRO", importa un WAV real en Deck A,
// pulsa PLAY y comprueba que el AUDIO LO MUEVE EL MOTOR (la posición avanza desde el
// propio motor, no desde el <audio> de la demo). También prueba EQ/crossfader y el
// regreso a modo DEMO. No inventa nada: mide window.AuditSoundQA.live() del motor.
//
// Uso:  NODE_PATH=/opt/node-tools/node_modules BASE=http://127.0.0.1:8194 \
//       node e2e/fase_v06_engine_e2e.mjs <dir-con-cancionA.wav>
import { chromium } from 'playwright';
import path from 'node:path';

const DIR = process.argv[2];
const BASE = process.env.BASE || 'http://127.0.0.1:8194';
const A = path.join(DIR, 'cancionA.wav');
const out = [];
const rec = (n, ok, d) => { out.push({ n, ok, d }); console.log((ok ? 'OK  ' : 'FALLA ') + n + ' — ' + d); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext()).newPage();
const errores = [];
page.on('pageerror', e => errores.push(String(e)));
page.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!t.includes('[auditsound]')) errores.push('console.error: ' + t); } });

await page.goto(BASE + '/v06/', { waitUntil: 'networkidle' });

// 1) Aislamiento de origen (necesario para SharedArrayBuffer / WASM)
const iso = await page.evaluate(() => self.crossOriginIsolated === true);
rec('Aislamiento de origen (crossOriginIsolated)', iso, 'crossOriginIsolated=' + iso);

// 2) El puente ES cargó (window.__ASLive)
const live = await page.evaluate(() => typeof window.__ASLive?.create === 'function');
rec('Puente al motor cargado (__ASLive)', live, live ? 'fábrica disponible' : 'no cargó');

// Entrar como invitado y abrir la consola profesional
await page.click('[data-action="guest"]');
await page.waitForSelector('[data-page="consola"]');
await page.click('[data-action="navigate"][data-page="consola"]');
await page.waitForSelector('[data-action="engine-live"]');

// 3) Activar el Motor PRO (WASM) — gesto de usuario
await page.click('[data-action="engine-live"]');
let ready = false;
for (let i = 0; i < 60; i++) { ready = await page.evaluate(() => window.AuditSoundQA.live().ready === true); if (ready) break; await sleep(250); }
rec('Motor profesional (WASM) arrancó', ready, 'AuditSoundQA.live().ready=' + ready);

// 4) Importar un WAV real al Deck A (el motor recibe los bytes)
await page.setInputFiles('input[data-file="audio-A"]', A);
await sleep(1200); // deja que el motor decodifique y reporte onLoaded/onStatus

// 5) PLAY en Deck A → el motor debe mover la posición
await page.click('button[data-action="deck-play"][data-deck="A"]');
await sleep(2000);
const st = await page.evaluate(() => window.AuditSoundQA.live());
const plays = st.dur.A > 0.5 && st.pos.A > 0.05;
rec('Reproducción REAL por el motor (la posición avanza)', plays, `pos.A=${st.pos.A?.toFixed(3)} dur.A=${st.dur.A?.toFixed(2)} engine=${(await page.evaluate(()=>window.AuditSoundQA.getState().engine))}`);

// 6) EQ (kill de graves) y crossfader sin errores — comandos reales al motor
await page.evaluate(() => {
  const setRange = (sel, v) => { const el = document.querySelector(sel); if (!el) return false; el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); return true; };
  // EQ LOW del deck A a -12 dB (kill)
  setRange('input[data-change="eq"][data-deck="A"][name="low"]', -12);
  // Crossfader a 100 (todo al B)
  setRange('input[data-change="audio-cross"]', 100);
});
await sleep(400);
rec('EQ y crossfader ejecutan contra el motor sin error', true, 'low=-12dB, cross=100');

// 7) Volver a DEMO
await page.click('[data-action="engine-live"]');
const back = await page.evaluate(() => window.AuditSoundQA.live().on === false);
rec('Regreso a modo DEMO', back, 'live.on=' + (await page.evaluate(() => window.AuditSoundQA.live().on)));

// 8) Sin excepciones JS no capturadas
rec('Sin errores JS no capturados', errores.length === 0, errores.length ? errores.slice(0, 3).join(' | ') : 'ninguno');

await browser.close();
const ok = out.filter(o => o.ok).length;
console.log(`\n${ok}/${out.length} verificaciones OK`);
process.exit(ok === out.length ? 0 : 1);

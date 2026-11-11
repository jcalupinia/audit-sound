// EQ del «motor profesional» (WASM) desde la consola v0.6 — regresión del hallazgo H-01.
// Antes, la consola enviaba la banda alta como `undefined` (d.eq.high en lugar de d.eq.hi) y el motor
// la convertía en ganancia 0: el agudo desaparecía siempre, aunque el EQ estuviera a 0 dB (−31 dB a 6 kHz).
// Comprueba, grabando el máster del motor con un tono de 6 kHz:
//   1) la consola envía las 3 bandas como números;
//   2) con el EQ a 0 dB el agudo no se atenúa (±1,5 dB respecto del EQ plano puesto a mano);
//   3) una banda no numérica (NaN) llega al motor como plana, no como silencio (protección en C++);
//   4) bajar la perilla HI de la consola sí atenúa el agudo (la banda está bien conectada).
// Requiere el motor WASM compilado (wasm/build/audit_engine.{js,wasm}).
// Uso: node web/pro/v06/tests/eq_motor_profesional_e2e.mjs [carpeta de wasm/build]   (desde la raíz)
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const WASM = resolve(process.argv[2] || join(REPO, 'wasm/build'));
const PORT = 18000 + Math.floor(Math.random() * 1000);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const f of ['audit_engine.js', 'audit_engine.wasm']) {
  if (!existsSync(join(WASM, f))) { console.error(`Falta ${join(WASM, f)}: compila el motor WASM primero.`); process.exit(2); }
}
// Sitio de prueba: la web de la consola + el motor WASM (igual que la imagen de producción).
const ROOT = mkdtempSync(join(tmpdir(), 'as-eq-'));
cpSync(join(REPO, 'web/pro'), ROOT, { recursive: true });
for (const f of ['audit_engine.js', 'audit_engine.wasm']) cpSync(join(WASM, f), join(ROOT, f));
// Tono de 6 kHz (banda alta del EQ), 60 s (dura más que todas las grabaciones), 48 kHz mono 16 bits.
const SR = 48000, N = SR * 60, wav = Buffer.alloc(44 + N * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + N * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) wav.writeInt16LE(Math.round(0.3 * 32767 * Math.sin(2 * Math.PI * 6000 * i / SR)), 44 + i * 2);
const TONO = join(ROOT, 'tono_6k.wav');
writeFileSync(TONO, wav);

const web = spawn(process.execPath, [join(REPO, 'deploy/pro/server.js')],
  { env: { ...process.env, PORT: String(PORT), WEB_ROOT: ROOT, DJ_AGENT_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => web.stdout.on('data', (d) => String(d).includes('AUDIT SOUND PRO en') && r()));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
try {
  const p = await (await browser.newContext()).newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`http://127.0.0.1:${PORT}/v06/`);
  await p.locator('button[data-action=guest]').click();
  await p.evaluate(() => document.querySelector('button.navbtn[data-page="consola"]').click());
  // Se intercepta el puente del motor para ver lo que la consola le envía y poder grabar su máster.
  await p.waitForFunction(() => window.__ASLive && window.__ASLive.create);
  await p.evaluate(() => {
    const crear = window.__ASLive.create; window.__EQ = [];
    window.__ASLive.create = async (x) => { const br = await crear(x); const eq = br.eq.bind(br);
      br.eq = (...a) => { window.__EQ.push(a); return eq(...a); }; window.__B = br; return br; };
  });
  await p.locator('button[data-action=engine-live]').first().click();
  await p.waitForFunction(() => window.__ASWAVE && window.__ASWAVE.live(), null, { timeout: 30000 });
  await p.locator('input[data-file="audio-A"]').setInputFiles(TONO);
  await sleep(5000);
  await p.locator('button[data-action=deck-play][data-deck=A]').first().click();
  await sleep(1500);
  // RMS del máster grabado durante 2,5 s (se descarta el primer 30 % por el ajuste de los filtros).
  const rms = () => p.evaluate(async () => {
    const B = window.__B; B.recordStart(); await new Promise((r) => setTimeout(r, 2500)); const blob = await B.recordStop();
    const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await blob.arrayBuffer()); const d = buf.getChannelData(0);
    let s = 0, n = 0; for (let i = Math.floor(d.length * 0.3); i < d.length; i++) { s += d[i] * d[i]; n++; } return Math.sqrt(s / Math.max(1, n));
  });
  const dB = (a, b) => 20 * Math.log10(Math.max(a, 1e-9) / Math.max(b, 1e-9));
  const tipos = await p.evaluate(() => window.__EQ.map((a) => a.slice(1).map((v) => typeof v)));
  ok(tipos.length > 0 && tipos.every((t) => t.length === 3 && t.every((x) => x === 'number')),
    `la consola envía las 3 bandas del EQ como números (última llamada: ${JSON.stringify(await p.evaluate(() => window.__EQ.at(-1)))})`);

  const consola = await rms();
  await p.evaluate(() => window.__B.eq(0, 0, 0, 0));
  const plano = await rms();
  ok(plano > 0.01, `el motor reproduce el tono de 6 kHz (RMS con EQ plano ${plano.toFixed(4)})`);
  ok(Math.abs(dB(consola, plano)) <= 1.5, `con el EQ de la consola a 0 dB el agudo no se atenúa: ${dB(consola, plano).toFixed(1)} dB (RMS ${consola.toFixed(4)} / ${plano.toFixed(4)})`);

  await p.evaluate(() => window.__B.eq(0, 0, 0, NaN));
  const nan = await rms();
  ok(Math.abs(dB(nan, plano)) <= 1.5, `una banda NaN llega al motor como plana, no como silencio: ${dB(nan, plano).toFixed(1)} dB`);

  // La perilla HI del canal A al mínimo (−12 dB = corte de la banda en el aislador del motor).
  await p.evaluate(() => { const el = document.querySelector('input[data-change="eq"][data-deck="A"][name="hi"]');
    el.value = '-12'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  const corte = await rms();
  ok(dB(corte, plano) <= -12, `la perilla HI de la consola corta el agudo: ${dB(corte, plano).toFixed(1)} dB`);
  ok(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) {
  ok(false, 'excepción: ' + e.message);
} finally {
  await browser.close(); web.kill();
}
console.log('\n' + (fails ? `${fails} FALLA(S)` : 'TODO OK'));
process.exit(fails ? 1 : 0);

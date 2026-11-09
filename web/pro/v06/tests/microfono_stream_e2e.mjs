// Micrófonos en vivo · prueba de extremo a extremo con servicios REALES:
// Chromium (micrófono simulado con un archivo) → consola v0.6 → proxy (deploy/pro/server.js) →
// agente dj-agent REAL → motor C++ REAL (/api/voice) → Icecast → oyente.
// Verifica en el stream (no solo en la UI) que la voz suena y que el talkover baja la música.
//
// Requisitos: build/audit_sound_server compilado, icecast2, ffmpeg, Python con las dependencias de
// services/dj-agent (PYTHON=… opcional) y Playwright de Node. Uso: node web/pro/v06/tests/microfono_stream_e2e.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const PY = process.env.PYTHON || 'python3';
const SRV = process.env.AUDIT_SOUND_SERVER || join(REPO, 'build/audit_sound_server');
const TOK = 'tok-operador-mic-e2e';
const ICE = 18600 + Math.floor(Math.random() * 300), ENG = ICE + 1, AG = ICE + 2, WEB = ICE + 3;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const have = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch (e) { return false; } };
if (!existsSync(SRV) || !have('icecast2') || !have('ffmpeg')) {
  console.log('SALTADO: falta build/audit_sound_server, icecast2 o ffmpeg');
  process.exit(0);
}

const procs = [];
function start(cmd, args, env, cwd, ready, log) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(p);
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('no arrancó: ' + cmd)), 40000);
    const on = (d) => { if (log) log.push(String(d)); if (!ready || String(d).includes(ready)) { clearTimeout(t); res(p); } };
    p.stdout.on('data', on); p.stderr.on('data', on);
    if (!ready) setTimeout(() => { clearTimeout(t); res(p); }, 1500);
  });
}
async function until(fn, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) { /* reintenta */ } await sleep(200); }
  return false;
}

// ---------- preparar música, voz simulada e Icecast ----------
const tmp = mkdtempSync(join(tmpdir(), 'as-mic-'));
chmodSync(tmp, 0o755);
const music = join(tmp, 'music'), logs = join(tmp, 'logs');
for (const d of [music, logs, join(tmp, 'web')]) { mkdirSync(d); chmodSync(d, 0o777); }
// Música: un acorde grave constante (220 Hz) — fácil de distinguir de la voz simulada (1 kHz).
for (const n of ['Pista Uno', 'Pista Dos']) {
  execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', "aevalsrc='0.35*sin(2*PI*220*t)+0.1*sin(2*PI*330*t)':s=44100:d=240",
    '-ac', '2', '-b:a', '192k', join(music, n + '.mp3'), '-y']);
}
// «Voz»: ráfagas de 1 kHz (400 ms sí / 100 ms no), como frases cortas. Chromium la usa como micrófono.
const voiceWav = join(tmp, 'voz.wav');
execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i',
  "aevalsrc='0.6*sin(2*PI*1000*t)*lt(mod(t\\,0.5)\\,0.4)':s=48000:d=60", '-ac', '1', voiceWav, '-y']);

const srcpw = 'src_' + Math.random().toString(36).slice(2, 10);
const asRoot = process.getuid && process.getuid() === 0;
writeFileSync(join(tmp, 'icecast.xml'), `<icecast><limits><clients>10</clients><sources>2</sources></limits>
<authentication><source-password>${srcpw}</source-password><admin-user>admin</admin-user><admin-password>a${srcpw}</admin-password></authentication>
<hostname>localhost</hostname><listen-socket><port>${ICE}</port></listen-socket>
<paths><logdir>${logs}</logdir><webroot>${tmp}/web</webroot><adminroot>${tmp}/web</adminroot></paths><logging><loglevel>2</loglevel></logging>
${asRoot ? '<security><chroot>0</chroot><changeowner><user>nobody</user><group>nogroup</group></changeowner></security>' : ''}</icecast>`);

// Graba `secs` del stream como oyente y devuelve la energía (RMS) en 1 kHz (voz) y 220 Hz (música).
async function escuchar(secs) {
  const out = join(tmp, `oyente_${Date.now()}.raw`);
  try {
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-t', String(secs), '-i', `http://127.0.0.1:${ICE}/stream.mp3`,
      '-ac', '1', '-ar', '22050', '-f', 's16le', out, '-y'], { timeout: (secs + 15) * 1000 });
  } catch (e) { return null; }
  const buf = require('node:fs').readFileSync(out);
  const x = new Float32Array(buf.length / 2);
  for (let i = 0; i < x.length; i++) x[i] = buf.readInt16LE(i * 2) / 32768;
  const goertzel = (hz) => {  // amplitud de la componente `hz` (Goertzel por ventanas de 0,1 s, promedio)
    const N = 2205, k = 2 * Math.cos(2 * Math.PI * hz / 22050);
    let tot = 0, n = 0;
    for (let s = 0; s + N <= x.length; s += N) {
      let s1 = 0, s2 = 0;
      for (let i = 0; i < N; i++) { const s0 = x[s + i] + k * s1 - s2; s2 = s1; s1 = s0; }
      tot += Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) * 2 / N; n++;
    }
    return n ? tot / n : 0;
  };
  return { voz: goertzel(1000), musica: goertzel(220) };
}

const db = join(tmp, 'agent.db');
let browser;
try {
  await start('icecast2', ['-c', join(tmp, 'icecast.xml')], {}, tmp, null);
  const engLog = [];
  globalThis.__engLog = engLog;
  // Con GDB=1 (CI) el motor corre bajo gdb: si se cae, la traza queda en el registro.
  const useGdb = process.env.GDB === '1' && have('gdb');
  const engProc = start(useGdb ? 'gdb' : SRV, useGdb ? ['-q', '-batch', '-ex', 'run', '-ex', 'bt', '-ex', 'thread apply all bt 8', SRV] : [], { AUDIT_SOUND_MUSIC_DIR: music, AUDIT_SOUND_ICECAST_HOST: '127.0.0.1', AUDIT_SOUND_ICECAST_PORT: String(ICE),
    AUDIT_SOUND_ICECAST_MOUNT: '/stream.mp3', AUDIT_SOUND_ICECAST_USER: 'source', AUDIT_SOUND_ICECAST_PASSWORD: srcpw,
    AUDIT_SOUND_API_USER: 'motor', AUDIT_SOUND_API_PASS: 'clave-motor', AUDIT_SOUND_API_PORT: String(ENG) }, REPO, 'Control API en el puerto', engLog);
  (await engProc).on('exit', (code, sig) => engLog.push(`\n[prueba] el motor terminó: código ${code}, señal ${sig}\n`));
  await start(PY, ['-m', 'uvicorn', '--factory', 'app.main:create_app', '--host', '127.0.0.1', '--port', String(AG)],
    { DJ_AGENT_DB_PATH: db, DJ_AGENT_ENGINE: 'control_api', DJ_AGENT_ENGINE_URL: `http://127.0.0.1:${ENG}`,
      DJ_AGENT_ENGINE_USER: 'motor', DJ_AGENT_ENGINE_PASS: 'clave-motor', DJ_AGENT_DEV_TOKENS: `${TOK}:dj:operator:org1` },
    join(REPO, 'services/dj-agent'), 'Uvicorn running');
  await start(process.execPath, [join(REPO, 'deploy/pro/server.js')],
    { PORT: String(WEB), WEB_ROOT: join(REPO, 'web/pro'), DJ_AGENT_URL: `http://127.0.0.1:${AG}` }, REPO, 'AUDIT SOUND PRO en');

  // Lector del estado del motor (sesión aparte, sin control: solo lee /api/status).
  const lt = await (await fetch(`http://127.0.0.1:${ENG}/api/login`, { method: 'POST', body: 'user=motor&pass=clave-motor&name=lector',
    headers: { 'content-type': 'application/x-www-form-urlencoded' } })).json();
  const voz = async () => (await (await fetch(`http://127.0.0.1:${ENG}/api/status`, { headers: { authorization: 'Bearer ' + lt.token } })).json()).voice;
  ok(!!(await voz()), 'el motor real expone el estado de la voz en /api/status');

  await sleep(3000);
  const antes = await escuchar(4);
  ok(antes && antes.musica > 0.05 && antes.voz < antes.musica / 8,
    `antes de hablar: el stream solo trae música (220 Hz ${antes && antes.musica.toFixed(3)}, 1 kHz ${antes && antes.voz.toFixed(3)})`);

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${voiceWav}`, '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const mic = () => page.evaluate(() => window.__ASMIC.state());

  await page.goto(`http://127.0.0.1:${WEB}/v06/`, { waitUntil: 'load' });
  await page.locator('button[data-action=guest]').click();
  await page.locator('button.navbtn[data-page=agente]').first().click();
  await page.fill('form[data-form=agent-link] input[name=token]', TOK);
  await page.locator('form[data-form=agent-link] button[type=submit]').click();
  ok(await until(async () => (await page.locator('main').innerText()).includes('AGENTE REAL CONECTADO'), 15000), 'consola conectada al agente real');

  await page.locator('button.navbtn[data-page=microfonos]').first().click();
  ok((await page.locator('main').innerText()).includes('Enviar al stream'), 'la pantalla de micrófonos ofrece «Enviar al stream»');
  await page.locator('button[data-action=mic-processing]').click();   // el tono de prueba no es voz: sin supresión de ruido
  await page.locator('button[data-action=mic-enable][data-id="1"]').click();
  ok(await until(async () => (await mic()).open.includes(1)), 'el micrófono 1 se abre de verdad (getUserMedia)');
  ok(await until(async () => (await mic()).level > -35, 6000), 'el medidor de nivel registra la voz en la consola');
  ok(await until(async () => (await mic()).ducked), 'talkover automático en la consola: la música local se atenúa al hablar');

  await page.locator('button[data-action=mic-stream]').click();
  ok(await until(async () => (await mic()).wsOpen, 8000), 'el agente acepta el canal de voz (operador)');
  ok(await until(async () => (await voz()).received_s > 3, 15000), 'la voz llega al motor por el agente (más de 3 s recibidos)');
  const v1 = await voz();
  ok(v1.active && v1.music_gain < 0.4, `el motor mezcla la voz y baja la música (ganancia ${v1.music_gain})`);
  ok(await until(async () => ((await mic()).stats || {}).sent_s > 2), 'la consola muestra los segundos enviados');
  ok((await page.locator('#mic-status').innerText()).includes('AL AIRE EN EL STREAM'), 'la consola indica «AL AIRE EN EL STREAM»');

  const hablando = await escuchar(5);
  ok(hablando && hablando.voz > 0.05, `el oyente escucha la voz en el stream (1 kHz ${hablando && hablando.voz.toFixed(3)})`);
  ok(hablando && hablando.musica < antes.musica * 0.45,
    `el oyente oye la música atenuada mientras se habla (220 Hz ${hablando && hablando.musica.toFixed(3)} vs ${antes.musica.toFixed(3)})`);

  // Talkover apagado desde la consola → el motor deja de atenuar.
  await page.selectOption('select[data-change=talkover-mode]', 'off');
  ok(await until(async () => { const v = await voz(); return v.talkover === 0 && v.music_gain > 0.95; }, 8000),
    'talkover «Apagado» llega al motor: la música vuelve a su volumen con la voz encima');

  // Quitar del stream → la voz deja de entrar y el motor vuelve a solo música.
  await page.locator('button[data-action=mic-stream]').click();
  ok(await until(async () => !(await mic()).sending, 5000), 'quitar del stream cierra el canal de voz');
  ok(await until(async () => !(await voz()).active, 8000), 'el motor deja de mezclar voz al quitarla');
  // Icecast entrega al oyente nuevo los últimos ~3 s del stream (búfer de arranque): se espera a que
  // salgan del búfer para no medir la voz de hace unos segundos.
  await sleep(5000);
  const despues = await escuchar(4);
  ok(despues && despues.voz < despues.musica / 8 && despues.musica > antes.musica * 0.9,
    `después: el stream vuelve a solo música a volumen normal (220 Hz ${despues && despues.musica.toFixed(3)})`);
  ok(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) {
  ok(false, 'excepción: ' + (e && e.stack || e));
} finally {
  if (fails && globalThis.__engLog) console.log('--- registro del motor (últimas líneas) ---\n' + globalThis.__engLog.join('').split('\n').slice(-80).join('\n'));
  if (browser) await browser.close().catch(() => {});
  for (const p of procs.reverse()) { try { p.kill('SIGTERM'); } catch (e) { /* ya terminó */ } }
}
console.log('\n' + (fails ? `${fails} FALLA(S)` : 'TODO OK'));
process.exit(fails ? 1 : 0);

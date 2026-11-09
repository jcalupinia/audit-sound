// Efectos de audio · prueba de extremo a extremo con servicios REALES:
// Chromium → consola v0.6 (bancos FX) → proxy → agente dj-agent REAL (comando «fx») → motor C++ REAL →
// Icecast → oyente. Verifica en el stream (no solo en la UI) que el filtro quita los agudos y que al
// apagarlo vuelven, y que el motor refleja eco/reverb configurados desde la consola.
//
// Requisitos: build/audit_sound_server compilado, icecast2, ffmpeg, Python con las dependencias de
// services/dj-agent (PYTHON=… opcional) y Playwright de Node. Uso: node web/pro/v06/tests/efectos_stream_e2e.mjs
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
const TOK = 'tok-operador-fx-e2e';
const ICE = 19100 + Math.floor(Math.random() * 300), ENG = ICE + 1, AG = ICE + 2, WEB = ICE + 3;
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
const tmp = mkdtempSync(join(tmpdir(), 'as-fx-'));
chmodSync(tmp, 0o755);
const music = join(tmp, 'music'), logs = join(tmp, 'logs');
for (const d of [music, logs, join(tmp, 'web')]) { mkdirSync(d); chmodSync(d, 0o777); }
// Música: un grave (220 Hz) y un agudo (3 kHz) constantes: el filtro debe quitar el agudo y dejar el grave.
for (const n of ['Pista Uno', 'Pista Dos']) {
  execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', "aevalsrc='0.3*sin(2*PI*220*t)+0.2*sin(2*PI*3000*t)':s=44100:d=240",
    '-ac', '2', '-b:a', '192k', join(music, n + '.mp3'), '-y']);
}
const srcpw = 'src_' + Math.random().toString(36).slice(2, 10);
const asRoot = process.getuid && process.getuid() === 0;
writeFileSync(join(tmp, 'icecast.xml'), `<icecast><limits><clients>10</clients><sources>2</sources></limits>
<authentication><source-password>${srcpw}</source-password><admin-user>admin</admin-user><admin-password>a${srcpw}</admin-password></authentication>
<hostname>localhost</hostname><listen-socket><port>${ICE}</port></listen-socket>
<paths><logdir>${logs}</logdir><webroot>${tmp}/web</webroot><adminroot>${tmp}/web</adminroot></paths><logging><loglevel>2</loglevel></logging>
${asRoot ? '<security><chroot>0</chroot><changeowner><user>nobody</user><group>nogroup</group></changeowner></security>' : ''}</icecast>`);

// Graba `secs` del stream como oyente y devuelve la amplitud en 3 kHz (agudo) y 220 Hz (grave).
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
  return { agudo: goertzel(3000), grave: goertzel(220) };
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

  const fxEng = async () => (await (await fetch(`http://127.0.0.1:${ENG}/api/status`, { headers: { authorization: 'Bearer ' + lt.token } })).json()).fx;
  ok(Array.isArray(await fxEng()) && (await fxEng()).length === 2, 'el motor real expone sus 2 bancos de efectos en /api/status');
  await sleep(3000);
  const antes = await escuchar(4);
  ok(antes && antes.agudo > 0.05 && antes.grave > 0.1, `sin efectos: el oyente oye grave y agudo (220 Hz ${antes && antes.grave.toFixed(3)}, 3 kHz ${antes && antes.agudo.toFixed(3)})`);

  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const fxUi = () => page.evaluate(() => window.__ASFX.state());
  const setSel = (change, id, v) => page.evaluate(([c, id, v]) => { const el = document.querySelector(`[data-change="${c}"][data-id="${id}"]`); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [change, id, v]);
  const setRange = (change, id, v) => page.evaluate(([c, id, v]) => { const el = document.querySelector(`input[data-change="${c}"][data-id="${id}"]`); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [change, id, v]);

  await page.goto(`http://127.0.0.1:${WEB}/v06/`, { waitUntil: 'load' });
  await page.locator('button[data-action=guest]').click();
  await page.locator('button.navbtn[data-page=efectos]').first().click();
  ok((await page.locator('main').innerText()).includes('Conecta el Agente DJ'), 'sin agente, la pantalla avisa que los efectos no suenan');
  await page.locator('button.navbtn[data-page=agente]').first().click();
  await page.fill('form[data-form=agent-link] input[name=token]', TOK);
  await page.locator('form[data-form=agent-link] button[type=submit]').click();
  ok(await until(async () => (await page.locator('main').innerText()).includes('AGENTE REAL CONECTADO'), 15000), 'consola conectada al agente real');

  await page.locator('button.navbtn[data-page=efectos]').first().click();
  await setSel('fx-type', 1, 'Filter');
  await setSel('fx-channel', 1, 'Master');
  await setRange('fx-wet', 1, 100);
  await setRange('fx-param', 1, 8);          // pasa-bajos fuerte
  if (!(await fxUi())[0].on) await page.locator('button[data-action=fx-toggle][data-id="1"]').click();
  ok(await until(async () => { const f = (await fxEng())[0]; return f.on && f.type === 'filter' && f.target === 'master' && f.wet > 0.99 && f.param < 0.1; }, 8000),
    'el filtro configurado en la consola llega al motor (pasa-bajos en la salida general)');
  ok(await until(async () => (await page.locator('#fx-status-1').innerText()).includes('SONANDO EN EL STREAM'), 5000), 'la consola indica «SONANDO EN EL STREAM»');
  await sleep(5000);   // búfer de arranque de Icecast
  const filtrado = await escuchar(5);
  ok(filtrado && filtrado.agudo < antes.agudo * 0.18, `el oyente pierde los agudos (3 kHz ${filtrado && filtrado.agudo.toFixed(3)} vs ${antes.agudo.toFixed(3)})`);
  ok(filtrado && filtrado.grave > antes.grave * 0.7, `el oyente conserva los graves (220 Hz ${filtrado && filtrado.grave.toFixed(3)})`);

  // Banco 2: reverb en el deck B, con sincronía apagada.
  await setSel('fx-type', 2, 'Reverb');
  await setSel('fx-channel', 2, 'B');
  await setRange('fx-param', 2, 70);
  await page.locator('button[data-action=fx-toggle][data-id="2"]').click();
  ok(await until(async () => { const f = (await fxEng())[1]; return f.on && f.type === 'reverb' && f.target === 'B' && Math.abs(f.param - 0.7) < 0.01; }, 8000),
    'el banco 2 (reverb en el deck B) llega al motor');

  // Apagar el filtro: los agudos vuelven.
  await page.locator('button[data-action=fx-toggle][data-id="1"]').click();
  ok(await until(async () => !(await fxEng())[0].on, 5000), 'apagar el banco 1 en la consola lo apaga en el motor');
  await sleep(5000);
  const despues = await escuchar(4);
  ok(despues && despues.agudo > antes.agudo * 0.8, `al apagar el filtro vuelven los agudos (3 kHz ${despues && despues.agudo.toFixed(3)})`);
  ok(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) {
  ok(false, 'excepción: ' + (e && e.stack || e));
} finally {
  if (fails && globalThis.__engLog) {
    const all = globalThis.__engLog.join('').split('\n');
    console.log('--- motor: líneas sobre Icecast ---\n' + all.filter((l) => /cecast|shout|StreamSink|reconect/i.test(l)).slice(-30).join('\n'));
    console.log('--- registro del motor (últimas líneas) ---\n' + all.slice(-60).join('\n'));
    try { console.log('--- Icecast error.log ---\n' + require('node:fs').readFileSync(join(logs, 'error.log'), 'utf8').split('\n').slice(-30).join('\n')); } catch (e) { /* sin registro */ }
  }
  if (browser) await browser.close().catch(() => {});
  for (const p of procs.reverse()) { try { p.kill('SIGTERM'); } catch (e) { /* ya terminó */ } }
}
console.log('\n' + (fails ? `${fails} FALLA(S)` : 'TODO OK'));
process.exit(fails ? 1 : 0);

// Fase 5 · Prueba de extremo a extremo en Chromium: consola v0.6 → proxy (deploy/pro/server.js)
// → servicio dj-agent REAL (uvicorn, motor simulado). Verifica en el SERVIDOR, no solo en la UI:
// conexión, cambio de modo, órdenes en español, políticas, propuestas con aprobación, eventos en
// vivo, rechazo del servidor con reversión, agente caído y modo demostración sin agente.
//
// Requisitos: Python con las dependencias de services/dj-agent (PYTHON=… opcional) y Playwright
// de Node (preinstalado en el entorno). Uso: node web/pro/v06/tests/agent_live_e2e.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const PY = process.env.PYTHON || 'python3';
const SHOTS = process.env.SHOTS || '';
const TOK_OP = 'tok-operador-e2e-01', TOK_LIS = 'tok-oyente-e2e-001', TOK_SUP = 'tok-supervisor-e2e-1';
const AG_PORT = 18795, WEB_PORT = 18096, WEB2_PORT = 18097;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(cmd, args, env, cwd, ready) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('no arrancó: ' + cmd)), 30000);
    const on = (d) => { if (String(d).includes(ready)) { clearTimeout(t); res(p); } };
    p.stdout.on('data', on); p.stderr.on('data', on);
  });
}
async function api(path, token, opts = {}) {
  const r = await fetch(`http://127.0.0.1:${AG_PORT}/api/v1/dj-agent${path}`,
    { ...opts, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(opts.headers || {}) } });
  return r.json();
}
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) { /* reintenta */ } await sleep(150); }
  return false;
}

const db = join(mkdtempSync(join(tmpdir(), 'as-e2e-')), 'agent.db');
const agentEnv = { DJ_AGENT_DB_PATH: db, DJ_AGENT_ENGINE: 'fake',
  DJ_AGENT_DEV_TOKENS: `${TOK_OP}:ana:operator:org1;${TOK_LIS}:luis:listener:org1;${TOK_SUP}:sara:supervisor:org1` };
let agent = await start(PY, ['-m', 'uvicorn', '--factory', 'app.main:create_app', '--host', '127.0.0.1', '--port', String(AG_PORT)],
  agentEnv, join(REPO, 'services/dj-agent'), 'Uvicorn running');
const web = await start(process.execPath, [join(REPO, 'deploy/pro/server.js')],
  { PORT: String(WEB_PORT), WEB_ROOT: join(REPO, 'web/pro'), DJ_AGENT_URL: `http://127.0.0.1:${AG_PORT}` }, REPO, 'AUDIT SOUND PRO en');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const st = () => page.evaluate(() => window.AuditSoundQA.getState());
const goAgent = () => page.locator('button.navbtn[data-page=agente]').first().click();

try {
  await page.goto(`http://127.0.0.1:${WEB_PORT}/v06/`, { waitUntil: 'load' });
  await page.locator('button[data-action=guest]').click();
  await goAgent();
  ok(await page.locator('form[data-form=agent-link]').count() === 1, 'el servidor anuncia el agente: aparece «Conectar agente»');

  // 1) Conexión con token de operador
  await page.fill('form[data-form=agent-link] input[name=token]', TOK_OP);
  await page.locator('form[data-form=agent-link] button[type=submit]').click();
  ok(await until(async () => (await page.locator('main').innerText()).includes('EVENTOS EN VIVO')), 'conectado al agente real y a sus eventos (WebSocket por el proxy)');
  const sessions = await api('/sessions', TOK_OP);
  const sid = sessions[0] && sessions[0].id;
  ok(!!sid && (await page.locator('main').innerText()).includes('AGENTE REAL CONECTADO'), 'sesión creada en el servidor y visible en la UI');
  ok(await page.evaluate(() => { try { return !localStorage.getItem('as.agent.token') && !!sessionStorage.getItem('as.agent.token'); } catch (e) { return false; } }),
    'el token solo vive en sessionStorage (no en localStorage)');
  // Prueba en vivo 2026-11-09: con el agente conectado seguía el aviso «Modo demostración… ninguna orden se
  // ejecuta en el servidor» junto a «las órdenes ya se ejecutan en el servidor».
  const chat0 = await page.locator('#agent-chat').innerText();
  ok(!chat0.includes('Modo demostración') && !chat0.includes('Sistema · DEMO'), 'al conectar se retira el aviso de demostración del chat');
  ok((await page.locator('footer.foot').innerText()).includes('CONECTADO AL SERVIDOR'), 'el pie ya no dice «NO PRODUCCIÓN» con el agente conectado');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'v06_agente_conectado.png'), fullPage: true });

  // 2) Modos: 30 cambios desde la UI, verificados en el servidor
  const seq = ['manual', 'hibrido', 'automatico'];
  let modeOk = true;
  for (let i = 0; i < 30; i++) {
    const m = seq[i % 3];
    await page.locator(`button[data-action=set-mode][data-mode=${m}]`).first().click();
    const want = { manual: 'MANUAL', hibrido: 'HIBRIDO', automatico: 'AUTOMATICO' }[m];
    if (!await until(async () => (await api('/sessions/' + sid, TOK_OP)).mode === want, 4000)) { modeOk = false; break; }
  }
  const s30 = await api('/sessions/' + sid, TOK_OP);
  ok(modeOk && s30.state === 'PLAYING', '30 cambios de modo aplicados en el servidor; la sesión sigue en PLAYING');

  // 2b) Un evento en vivo NO borra lo que el operador está escribiendo (regresión)
  await page.fill('form[data-form=agent] textarea[name=message]', 'texto a medio escribir');
  await page.focus('form[data-form=agent] textarea[name=message]');
  await api(`/sessions/${sid}/preferences`, TOK_OP, { method: 'PUT', body: JSON.stringify({ autonomy: 55 }) });
  ok(await until(async () => (await page.inputValue('main input[data-change=autonomy]')) === '55'), 'el cambio de otro cliente llega por WebSocket');
  ok(await page.inputValue('form[data-form=agent] textarea[name=message]') === 'texto a medio escribir',
    'el texto que se estaba escribiendo se conserva al llegar el evento');
  await page.fill('form[data-form=agent] textarea[name=message]', '');

  // 3) Orden en español → respuesta real del agente
  await page.locator('button[data-action=set-mode][data-mode=automatico]').first().click();
  await until(async () => (await api('/sessions/' + sid, TOK_OP)).mode === 'AUTOMATICO');
  await page.fill('form[data-form=agent] textarea[name=message]', 'salta la canción');
  await page.locator('form[data-form=agent] button[type=submit]').click();
  const answered = await until(async () => (await page.locator('#agent-chat').innerText()).includes('Agente DJ · reglas'));
  ok(answered, 'la orden la responde el agente real (reglas deterministas)' +
    (answered ? '' : ' — chat: ' + (await page.locator('#agent-chat').innerText()).slice(-400).replace(/\n/g, ' | ') +
      ' — servidor: ' + JSON.stringify(await api('/sessions/' + sid, TOK_OP)).slice(0, 300)));
  const cmds = await api(`/sessions/${sid}/commands`, TOK_OP);
  ok(cmds.some((c) => c.action === 'skip' && c.status === 'ACKNOWLEDGED'), 'el motor confirmó el salto (ACKNOWLEDGED)');
  // El mensaje dice qué hizo y el historial lo muestra (antes: «Hecho: la acción…» e historial vacío).
  const chat1 = await page.locator('#agent-chat').innerText();
  ok(chat1.includes('Saltar a la siguiente pista') && !chat1.includes('la acción'), 'la respuesta dice qué hizo el agente');
  const hist = async () => page.evaluate(() => { const h = [...document.querySelectorAll('h3')].find((x) => x.textContent.includes('Historial de decisiones'));
    return h && h.nextElementSibling ? h.nextElementSibling.innerText : ''; });
  ok(await until(async () => { const t = await hist(); return t.includes('Saltar a la siguiente pista') && t.includes('EJECUTADA'); }),
    'el historial de decisiones registra el salto ejecutado por el agente' + ' — historial: ' + (await hist()).slice(0, 200).replace(/\n/g, ' | '));

  // 4) Políticas: modelo, autonomía y reglas llegan al servidor
  await page.selectOption('select[name=agent-model]', 'qwen');
  ok(await until(async () => (await api(`/sessions/${sid}/preferences`, TOK_OP)).model_route === 'qwen'), 'ruta de modelo guardada en el servidor');
  await page.selectOption('select[name=agent-approval]', 'false');
  ok(await until(async () => (await api(`/sessions/${sid}/preferences`, TOK_OP)).approval_required === false), 'aprobación «bajo política» guardada en el servidor');
  await page.selectOption('select[name=agent-approval]', 'true');
  await until(async () => (await api(`/sessions/${sid}/preferences`, TOK_OP)).approval_required === true);

  // 5) Propuesta en HÍBRIDO → aprobación desde la UI
  await page.locator('button[data-action=set-mode][data-mode=hibrido]').first().click();
  await until(async () => (await api('/sessions/' + sid, TOK_OP)).mode === 'HIBRIDO');
  // El cambio a HÍBRIDO llega por WebSocket y redibuja el panel: un clic que cae en ese instante se
  // pierde (mismo caso que «Aprobar», más abajo). Se reintenta solo si el servidor no tiene ninguna
  // propuesta pendiente, para no crear duplicadas; si el servidor no crea la propuesta, sigue fallando.
  const pendiente = async () => (await api(`/sessions/${sid}/proposals`, TOK_OP)).some((p) => p.status === 'PENDING');
  for (let i = 0; i < 3 && !(await pendiente()); i++) {
    await page.locator('button[data-action=agent-test-approval]').click();
    await until(pendiente, 3000);
  }
  ok(await until(async () => (await page.locator('button[data-action=agent-approve]').count()) > 0), 'la propuesta del servidor aparece como solicitud de aprobación');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'v06_agente_propuesta.png'), fullPage: true });
  // Los eventos del agente redibujan el panel: si el botón se reemplaza justo en el clic, el clic se
  // pierde (cae en un nodo ya desconectado). Se reintenta solo si el servidor no registró la decisión.
  const decided = async () => (await api(`/sessions/${sid}/proposals`, TOK_OP)).some((p) => ['APPROVED', 'EXECUTED'].includes(p.status));
  let approved = false;
  for (let i = 0; i < 3 && !approved; i++) {
    if (await page.locator('button[data-action=agent-approve]').count()) await page.locator('button[data-action=agent-approve]').first().click();
    approved = await until(decided, 3000);
  }
  ok(approved, 'la aprobación se registró en el servidor');
  ok(await until(async () => (await page.locator('button[data-action=agent-approve]').count()) === 0), 'la solicitud desaparece de pendientes en la UI');

  // 6) Evento en vivo: otro cliente cambia el modo → la UI lo refleja sin recargar
  await fetch(`http://127.0.0.1:${AG_PORT}/api/v1/dj-agent/sessions/${sid}/mode`, { method: 'POST',
    headers: { authorization: 'Bearer ' + TOK_OP, 'content-type': 'application/json', 'idempotency-key': 'e2e-ws-1' },
    body: JSON.stringify({ mode: 'MANUAL' }) });
  ok(await until(async () => (await st()).mode === 'manual'), 'cambio hecho por otro cliente llega por WebSocket a la UI');

  // 7) Rechazo del servidor → la UI vuelve al estado del servidor (oyente sin permiso)
  await page.locator('button[data-action=agent-disconnect]').click();
  await page.fill('form[data-form=agent-link] input[name=token]', TOK_LIS);
  await page.locator('form[data-form=agent-link] button[type=submit]').click();
  await until(async () => (await page.locator('main').innerText()).includes('AGENTE REAL CONECTADO'));
  await page.locator('button[data-action=set-mode][data-mode=automatico]').first().click();
  ok(await until(async () => (await st()).mode === 'manual'), 'el oyente no puede cambiar el modo: la UI se revierte a MANUAL');
  ok((await api('/sessions/' + sid, TOK_OP)).mode === 'MANUAL', 'el servidor sigue en MANUAL');

  // 8) Agente caído: la orden avisa del fallo, la consola sigue operativa
  agent.kill('SIGKILL');
  await sleep(500);
  await page.fill('form[data-form=agent] textarea[name=message]', 'sube la energía');
  await page.locator('form[data-form=agent] button[type=submit]').click();
  ok(await until(async () => (await page.locator('#agent-chat').innerText()).includes('no procesó la orden')), 'con el agente caído la UI muestra el fallo (no inventa respuesta)');
  ok(await until(async () => (await page.locator('main').innerText()).includes('RECONECTANDO EVENTOS')), 'la UI indica que los eventos se están reconectando');
  await page.locator('button.navbtn[data-page=consola]').first().click();
  ok(await page.locator('button[data-action=deck-play]').count() === 2, 'la consola sigue operativa sin el agente');

  // 9) Reinicio del agente: los eventos se reconectan solos
  agent = await start(PY, ['-m', 'uvicorn', '--factory', 'app.main:create_app', '--host', '127.0.0.1', '--port', String(AG_PORT)],
    agentEnv, join(REPO, 'services/dj-agent'), 'Uvicorn running');
  await goAgent();
  ok(await until(async () => (await page.locator('main').innerText()).includes('EVENTOS EN VIVO'), 40000), 'al volver el agente, los eventos se reconectan sin recargar');
} catch (e) {
  ok(false, 'excepción: ' + (e && e.stack || e));
}

// 10) Sin agente configurado → modo demostración, como antes
const web2 = await start(process.execPath, [join(REPO, 'deploy/pro/server.js')],
  { PORT: String(WEB2_PORT), WEB_ROOT: join(REPO, 'web/pro'), DJ_AGENT_URL: '' }, REPO, 'AUDIT SOUND PRO en');
const p2 = await browser.newPage();
p2.on('pageerror', (e) => errors.push(String(e)));
await p2.goto(`http://127.0.0.1:${WEB2_PORT}/v06/`, { waitUntil: 'load' });
await p2.locator('button[data-action=guest]').click();
await p2.locator('button.navbtn[data-page=agente]').first().click();
const txt2 = await p2.locator('main').innerText();
ok(txt2.includes('NO CONFIGURADO EN ESTE SERVIDOR') && txt2.includes('RESPUESTAS MOCK IDENTIFICADAS'), 'sin agente: modo demostración identificado');
await p2.locator('button[data-action=set-mode][data-mode=automatico]').first().click();
ok((await p2.evaluate(() => window.AuditSoundQA.getState().mode)) === 'automatico', 'sin agente los modos siguen funcionando en la interfaz');

ok(errors.length === 0, 'sin errores de JavaScript en la página' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
web.kill(); web2.kill(); agent.kill();
console.log(fails ? `\n${fails} FALLA(S)` : '\nTODO OK');
process.exit(fails ? 1 : 0);

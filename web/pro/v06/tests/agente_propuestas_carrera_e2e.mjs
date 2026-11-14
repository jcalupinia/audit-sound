// Propuestas del agente en la consola v0.6: una respuesta vieja no debe borrar una propuesta nueva.
// Regresión del hallazgo H-25. La consola sincroniza el historial con agentSyncProposals() cada vez que
// llega un evento (propuesta creada, comando confirmado…), así que suele haber varias sincronizaciones a la
// vez. Antes, cada una escribía el historial con su respuesta aunque llegara tarde: si la más vieja (pedida
// ANTES de crearse la propuesta) llegaba la última, borraba la propuesta y el botón «Aprobar» desaparecía
// hasta el siguiente evento. Así falló dos veces agent_live_e2e en la CI (#81, #85).
// Aquí la carrera se fuerza: se retrasa a propósito la respuesta de una sincronización iniciada antes.
// Uso: PYTHON=… node web/pro/v06/tests/agente_propuestas_carrera_e2e.mjs (desde la raíz del repo).
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
const TOK_OP = 'tok-operador-carrera-1';
const AG_PORT = 18796, WEB_PORT = 18098;
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
async function api(path, opts = {}) {
  const r = await fetch(`http://127.0.0.1:${AG_PORT}/api/v1/dj-agent${path}`,
    { ...opts, headers: { authorization: 'Bearer ' + TOK_OP, 'content-type': 'application/json', ...(opts.headers || {}) } });
  return r.json();
}
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) { /* reintenta */ } await sleep(100); }
  return false;
}

const db = join(mkdtempSync(join(tmpdir(), 'as-carrera-')), 'agent.db');
const agent = await start(PY, ['-m', 'uvicorn', '--factory', 'app.main:create_app', '--host', '127.0.0.1', '--port', String(AG_PORT)],
  { DJ_AGENT_DB_PATH: db, DJ_AGENT_ENGINE: 'fake', DJ_AGENT_DEV_TOKENS: `${TOK_OP}:ana:operator:org1` },
  join(REPO, 'services/dj-agent'), 'Uvicorn running');
const web = await start(process.execPath, [join(REPO, 'deploy/pro/server.js')],
  { PORT: String(WEB_PORT), WEB_ROOT: join(REPO, 'web/pro'), DJ_AGENT_URL: `http://127.0.0.1:${AG_PORT}` }, REPO, 'AUDIT SOUND PRO en');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const botones = () => page.locator('button[data-action=agent-approve]').count();

try {
  await page.goto(`http://127.0.0.1:${WEB_PORT}/v06/`, { waitUntil: 'load' });
  await page.locator('button[data-action=guest]').click();
  await page.locator('button.navbtn[data-page=agente]').first().click();
  await page.fill('form[data-form=agent-link] input[name=token]', TOK_OP);
  await page.locator('form[data-form=agent-link] button[type=submit]').click();
  ok(await until(async () => (await page.locator('main').innerText()).includes('EVENTOS EN VIVO')), 'consola conectada al agente real');
  const sid = (await api('/sessions'))[0].id;

  // HÍBRIDO con aprobación requerida: un plan se convierte en propuesta pendiente.
  await api(`/sessions/${sid}/preferences`, { method: 'PUT', body: JSON.stringify({ approval_required: true }) });
  await api(`/sessions/${sid}/mode`, { method: 'POST', headers: { 'idempotency-key': 'carrera-modo' }, body: JSON.stringify({ mode: 'HIBRIDO' }) });
  ok(await until(async () => (await api('/sessions/' + sid)).mode === 'HIBRIDO'), 'la sesión está en HÍBRIDO con aprobación requerida');
  ok((await botones()) === 0, 'al empezar no hay solicitudes de aprobación');

  // Sincronización «vieja»: se pide la lista de propuestas ahora (aún vacía) y su respuesta se retrasa 2,5 s.
  let retrasar = true, retrasada = false;
  await page.route(/\/api\/v1\/dj-agent\/sessions\/[^/]+\/proposals$/, async (route) => {
    if (retrasar && route.request().method() === 'GET') {
      retrasar = false;
      const vieja = await route.fetch();          // respuesta tomada ANTES de crear la propuesta
      await sleep(2500);
      retrasada = true;
      return route.fulfill({ response: vieja });
    }
    return route.continue();
  });
  await page.evaluate(() => { window.__ASAGENT.sync(); });
  await until(async () => !retrasar, 3000);

  // Mientras tanto se crea la propuesta: el evento «propuesta creada» la sincroniza y aparece «Aprobar».
  const r = await api(`/sessions/${sid}/plans`, { method: 'POST', headers: { 'idempotency-key': 'carrera-plan' }, body: JSON.stringify({ count: 4, energy_trend: 'steady' }) });
  ok(r.outcome === 'proposal', `el servidor crea una propuesta pendiente (${r.outcome})`);
  ok(await until(async () => (await botones()) > 0, 4000), 'la propuesta aparece como solicitud de aprobación');

  // Llega la respuesta vieja (sin la propuesta): no debe pisar el historial más nuevo.
  ok(await until(async () => retrasada, 5000), 'llegó la respuesta retrasada de la sincronización vieja');
  await sleep(600);
  ok((await botones()) > 0, 'tras la respuesta vieja la solicitud sigue visible (antes desaparecía)');
  const pendientes = (await api(`/sessions/${sid}/proposals`)).filter((p) => p.status === 'PENDING').length;
  ok(pendientes === 1, `el servidor sigue teniendo la propuesta pendiente (${pendientes})`);
  ok(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) {
  ok(false, 'excepción: ' + e.message);
} finally {
  await browser.close(); web.kill(); agent.kill();
}
console.log('\n' + (fails ? `${fails} FALLA(S)` : 'TODO OK'));
process.exit(fails ? 1 : 0);

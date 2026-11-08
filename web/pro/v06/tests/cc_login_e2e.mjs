// Fase 7 · Login unificado en Chromium: la consola usa la sesión AUDIT-IA (auditsound.cc.token) para
// conectarse al agente real, sin pegar llaves. El Command Center se SIMULA (solo /apps/auth/me).
// Uso: PYTHON=… node web/pro/v06/tests/cc_login_e2e.mjs
import http from 'node:http';
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
const AG = 18815, WEB = 18116;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) { /* reintenta */ } await sleep(150); }
  return false;
}
function start(cmd, args, env, cwd, ready) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('no arrancó: ' + cmd)), 30000);
    const on = (d) => { if (String(d).includes(ready)) { clearTimeout(t); res(p); } };
    p.stdout.on('data', on); p.stderr.on('data', on);
  });
}

// Command Center simulado
const ME = { 'cc-jorge': { email: 'jorge@firma.ec', apps: ['audit_sound'] }, 'cc-miron': { email: 'otro@firma.ec', apps: ['audit_sound'] } };
const cc = http.createServer((req, res) => {
  const tok = (req.headers.authorization || '').slice(7);
  if (req.url === '/api/v1/apps/auth/me' && ME[tok]) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(ME[tok])); }
  res.writeHead(401); res.end('{}');
});
await new Promise((r) => cc.listen(0, '127.0.0.1', r));
const CC = `http://127.0.0.1:${cc.address().port}/api/v1`;

const db = join(mkdtempSync(join(tmpdir(), 'as-cc-')), 'agent.db');
const agent = await start(PY, ['-m', 'uvicorn', '--factory', 'app.main:create_app', '--host', '127.0.0.1', '--port', String(AG)],
  { DJ_AGENT_DB_PATH: db, DJ_AGENT_ENGINE: 'fake', DJ_AGENT_DEV_TOKENS: '', DJ_AGENT_CC_API: CC,
    DJ_AGENT_CC_ROLES: 'jorge@firma.ec:admin' }, join(REPO, 'services/dj-agent'), 'Uvicorn running');
const web = await start(process.execPath, [join(REPO, 'deploy/pro/server.js')],
  { PORT: String(WEB), WEB_ROOT: join(REPO, 'web/pro'), DJ_AGENT_URL: `http://127.0.0.1:${AG}` }, REPO, 'AUDIT SOUND PRO en');
const browser = await chromium.launch();
const errors = [];
const URL = `http://127.0.0.1:${WEB}/v06/`;

try {
  // 1) Con sesión AUDIT-IA: se conecta sola, sin pegar llaves
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { try { localStorage.setItem('auditsound.cc.token', 'cc-jorge'); } catch (e) { /* */ } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(URL); await p.locator('button[data-action=guest]').click();
  await p.locator('button.navbtn[data-page=agente]').first().click();
  ok(await until(async () => (await p.locator('main').innerText()).includes('EVENTOS EN VIVO')), 'con sesión AUDIT-IA se conecta sola al agente');
  ok(await p.evaluate(() => !sessionStorage.getItem('as.agent.token')), 'no se copió el token a otro lugar');
  await p.locator('button[data-action=set-mode][data-mode=automatico]').first().click();
  ok(await until(async () => (await p.locator('main').innerText()).includes('AUTOMATICO · SERVIDOR')), 'como admin puede cambiar el modo');

  // 2) Desconectar y recargar: respeta la decisión (no se reconecta sola)
  await p.locator('button[data-action=agent-disconnect]').click();
  await p.reload(); await p.locator('button[data-action=guest]').click();
  await p.locator('button.navbtn[data-page=agente]').first().click();
  await sleep(1500);
  ok(!(await p.locator('main').innerText()).includes('EVENTOS EN VIVO'), 'tras «Desconectar» no se reconecta sola al recargar');
  ok(await p.locator('button[data-action=agent-connect-cc]').count() === 1, 'ofrece «Conectar con mi sesión AUDIT-IA»');
  await p.locator('button[data-action=agent-connect-cc]').click();
  ok(await until(async () => (await p.locator('main').innerText()).includes('EVENTOS EN VIVO')), 'el botón vuelve a conectar con la sesión');
  await ctx.close();

  // 3) Cuenta sin rol asignado: entra como oyente (no puede operar)
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript(() => { try { localStorage.setItem('auditsound.cc.token', 'cc-miron'); } catch (e) { /* */ } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(String(e)));
  await p2.goto(URL); await p2.locator('button[data-action=guest]').click();
  await p2.locator('button.navbtn[data-page=agente]').first().click();
  ok(await until(async () => (await p2.locator('main').innerText()).includes('EVENTOS EN VIVO')), 'otra cuenta AUDIT-IA se conecta como oyente');
  await p2.locator('button[data-action=set-mode][data-mode=manual]').first().click();
  ok(await until(async () => (await p2.locator('#toast').innerText().catch(() => '')).includes('no cambió el modo')), 'el oyente no puede cambiar el modo');
  await ctx2.close();

  // 4) Token de sesión inválido: no conecta y ofrece la llave de respaldo
  const ctx3 = await browser.newContext();
  await ctx3.addInitScript(() => { try { localStorage.setItem('auditsound.cc.token', 'caducado'); } catch (e) { /* */ } });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', (e) => errors.push(String(e)));
  await p3.goto(URL); await p3.locator('button[data-action=guest]').click();
  await p3.locator('button.navbtn[data-page=agente]').first().click();
  await sleep(1500);
  ok(!(await p3.locator('main').innerText()).includes('EVENTOS EN VIVO') && await p3.locator('form[data-form=agent-link]').count() === 1,
    'sesión caducada: no conecta y deja el formulario de llave');
  await ctx3.close();
} catch (e) {
  ok(false, 'excepción: ' + (e && e.stack || e));
}
ok(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close(); web.kill(); agent.kill(); cc.close();
console.log(fails ? `\n${fails} FALLA(S)` : '\nTODO OK');
process.exit(fails ? 1 : 0);

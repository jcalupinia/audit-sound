// La consola v0.6 con el inicio de sesión REAL del Command Center (simulado aquí):
// login.html → portada → «Mezclar» → v0.6 con la cuenta, sin entrada de demostración; sesión
// caducada → vuelve al login con el motivo; «Salir» cierra la sesión; y si el agente rechaza una
// sesión válida, la consola explica que falta configurarlo.
// Uso: PYTHON=… node web/pro/v06/tests/sesion_real_e2e.mjs (desde la raíz del repo).
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
const AG = 18900 + Math.floor(Math.random() * 50), WEB = 18960 + Math.floor(Math.random() * 30);
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

// Command Center simulado (CORS como el real). «cc-jorge» es la sesión vigente; cualquier otro token caducó.
const cc = http.createServer((req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const json = (code, obj) => { res.writeHead(code, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url.startsWith('/api/v1/apps/auth/login') && req.method === 'POST') return json(200, { access_token: 'cc-jorge', token_type: 'bearer', apps: ['audit_sound'], password_reset_required: false });
  if (req.url === '/api/v1/apps/auth/me') {
    if ((req.headers.authorization || '') === 'Bearer cc-jorge') return json(200, { email: 'jorge@firma.ec', display_name: 'Jorge', apps: ['audit_sound'], password_reset_required: false });
    return json(401, { detail: 'token inválido' });
  }
  json(404, {});
});
await new Promise((r) => cc.listen(0, '127.0.0.1', r));
const CC = `http://127.0.0.1:${cc.address().port}/api/v1`;

// Agente real SIN DJ_AGENT_CC_API: no acepta sesiones AUDIT-IA (caso «falta configurarlo»).
const db = join(mkdtempSync(join(tmpdir(), 'as-ses-')), 'agent.db');
const agent = await start(PY, ['-m', 'uvicorn', '--factory', 'app.main:create_app', '--host', '127.0.0.1', '--port', String(AG)],
  { DJ_AGENT_DB_PATH: db, DJ_AGENT_ENGINE: 'fake', DJ_AGENT_DEV_TOKENS: '', DJ_AGENT_CC_API: '' }, join(REPO, 'services/dj-agent'), 'Uvicorn running');
const web = await start(process.execPath, [join(REPO, 'deploy/pro/server.js')],
  { PORT: String(WEB), WEB_ROOT: join(REPO, 'web/pro'), AUDIT_SOUND_CC_API: CC, DJ_AGENT_URL: `http://127.0.0.1:${AG}` }, REPO, 'AUDIT SOUND PRO en');
const BASE = `http://127.0.0.1:${WEB}`;
const browser = await chromium.launch();
const errors = [];
const token = (p) => p.evaluate(() => localStorage.getItem('auditsound.cc.token'));

try {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));

  // 1) Sin sesión, la v0.6 manda al login real (no muestra la demo)
  await p.goto(BASE + '/v06/');
  ok(await until(async () => p.url().includes('/login.html')), 'sin sesión, la v0.6 lleva a login.html');
  ok(await p.locator('form#login-form').count() === 0, 'no aparece la entrada de demostración de la v0.6');

  // 2) Inicio de sesión real → portada → «Mezclar» abre la v0.6
  await p.locator('#user').fill('jorge@firma.ec'); await p.locator('#pass').fill('clave-de-prueba');
  await p.locator('#go').click();
  ok(await until(async () => p.url().endsWith('/index.html')), 'el login real lleva a la portada');
  ok(await p.locator('a.hot[href="./v06/"]').count() === 1, '«Mezclar» apunta a la consola v0.6');
  await p.locator('a.hot[href="./v06/"]').click();
  ok(await until(async () => (await p.locator('.topbar').innerText().catch(() => '')).includes('Jorge')), 'la v0.6 entra directo con la cuenta (cabecera «Sesión de Jorge»)');
  ok(!(await p.locator('.topbar').innerText()).includes('Sesión DEMO'), 'la cabecera ya no dice «Sesión DEMO»');

  // 3) El agente rechaza la sesión válida → la consola explica qué falta
  await p.locator('button.navbtn[data-page=agente]').first().click();
  await p.evaluate(() => { const b = document.querySelector('button[data-action=agent-connect-cc]'); if (b) b.click(); });
  ok(await until(async () => (await p.locator('#toast').innerText().catch(() => '')).includes('DJ_AGENT_CC_API')), 'si el agente no acepta una sesión válida, avisa que falta DJ_AGENT_CC_API');
  ok(await token(p) === 'cc-jorge', 'ese rechazo NO cierra la sesión del usuario');

  // 4) «Salir» cierra la sesión y vuelve al login
  await p.locator('button[data-action=logout]').first().click();
  ok(await until(async () => p.url().includes('/login.html')), '«Salir» vuelve a login.html');
  ok(!(await token(p)), '«Salir» borra la sesión guardada');

  // 5) Sesión caducada: la v0.6 vuelve al login con el motivo
  await p.evaluate(() => localStorage.setItem('auditsound.cc.token', 'cc-caducado'));
  await p.goto(BASE + '/v06/');
  ok(await until(async () => p.url().includes('motivo=caducada')), 'sesión caducada en la v0.6 → login con motivo');
  ok(await until(async () => (await p.locator('#msg').innerText()).includes('caducó')), 'el login explica «Tu sesión caducó»');
  ok(!(await token(p)), 'la sesión caducada se borra');

  // 6) login.html ya no reutiliza una sesión caducada; la portada tampoco la acepta
  await p.evaluate(() => localStorage.setItem('auditsound.cc.token', 'cc-caducado'));
  await p.goto(BASE + '/login.html'); await sleep(800);
  ok(p.url().includes('/login.html'), 'login.html con sesión caducada se queda para volver a entrar');
  await p.evaluate(() => localStorage.setItem('auditsound.cc.token', 'cc-caducado'));
  await p.goto(BASE + '/index.html');
  ok(await until(async () => p.url().includes('motivo=caducada')), 'la portada con sesión caducada vuelve al login');
  // y con sesión vigente, login.html sigue llevando directo a la portada
  await p.evaluate(() => localStorage.setItem('auditsound.cc.token', 'cc-jorge'));
  await p.goto(BASE + '/login.html');
  ok(await until(async () => p.url().endsWith('/index.html')), 'con sesión vigente, login.html pasa directo a la portada');
  await ctx.close();
} catch (e) {
  ok(false, 'excepción: ' + (e && e.stack || e));
}
ok(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close(); web.kill(); agent.kill(); cc.close();
console.log(fails ? `\n${fails} FALLA(S)` : '\nTODO OK');
process.exit(fails ? 1 : 0);

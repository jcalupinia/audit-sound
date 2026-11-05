// Pruebas del cliente de login de AUDIT SOUND (commandcenter.js) contra las
// Cuentas de Aplicaciones AUDIT-IA del Command Center. Backend simulado propio.
// Garantiza: (1) modo demo OPT-IN (bloqueado por defecto), (2) la base lleva el
// prefijo /api/v1, (3) permiso por app (?app=audit_sound), (4) errores 401/403.
import http from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let lastUrl = '', lastBody = '';
const srv = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/api/v1/apps/auth/login')) {
    lastUrl = req.url; let raw = ''; req.on('data', c => raw += c);
    req.on('end', () => {
      lastBody = raw;
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (!(req.headers['content-type'] || '').includes('application/x-www-form-urlencoded')) return send(415, {});
      const p = new URLSearchParams(raw);
      const app = new URL(req.url, 'http://x').searchParams.get('app');
      if (p.get('username') === 'dj' && p.get('password') === 'ok') {
        if (app && app !== 'audit_sound') return send(403, { detail: { code: 'app_forbidden', message: 'La cuenta no tiene acceso a esta aplicación.' } });
        return send(200, { access_token: 'TK', token_type: 'bearer', apps: ['audit_sound'], password_reset_required: true });
      }
      if (p.get('username') === 'sinapp' && p.get('password') === 'ok') return send(403, { detail: { code: 'app_forbidden', message: 'La cuenta no tiene acceso a esta aplicación.' } });
      return send(401, { detail: 'Credenciales incorrectas.' });
    });
    return;
  }
  res.writeHead(404).end('no');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port + '/api/v1';

const store = {};
globalThis.window = globalThis;
globalThis.localStorage = { getItem: k => k in store ? store[k] : null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const CC = await import(pathToFileURL(path.join(HERE, 'commandcenter.js')).href);
let P = 0, F = 0; const ok = (c, m) => { if (c) { P++; console.log('  OK  ' + m); } else { F++; console.log('  FAIL ' + m); } };

// 1) Sin backend y SIN demo → login BLOQUEADO (no entra nadie).
window.AUDIT_SOUND_CC_API = ''; window.AUDIT_SOUND_ALLOW_DEMO = undefined;
ok(CC.demoAllowed() === false, 'demoAllowed() = false por defecto');
let r = await CC.login('x', 'y', true);
ok(!r.ok && r.notConfigured === true && /no está configurado/i.test(r.error), 'sin backend y sin demo → LOGIN BLOQUEADO');
ok(!CC.isAuthed(), 'no queda sesión tras el bloqueo');

// 2) Sin backend pero demo habilitado a propósito → entra en demo.
window.AUDIT_SOUND_ALLOW_DEMO = '1';
ok(CC.demoAllowed() === true, 'demoAllowed() = true con AUDIT_SOUND_ALLOW_DEMO="1"');
r = await CC.login('x', 'y', true);
ok(r.ok && r.demo === true && r.apps.includes('audit_sound'), 'demo opt-in → entra solo para navegar');
CC.logout();

// 3) Con backend (base con prefijo /api/v1) → login real y permiso por app.
window.AUDIT_SOUND_ALLOW_DEMO = undefined;
window.AUDIT_SOUND_CC_API = base;
ok(CC.loginPath() === '/apps/auth/login', 'loginPath por defecto = /apps/auth/login');
ok(CC.appKey() === 'audit_sound', 'appKey por defecto = audit_sound');
r = await CC.login('dj', 'ok', true);
ok(r.ok && r.token === 'TK' && r.apps.includes('audit_sound'), 'login real OK → token + apps');
ok(/\/api\/v1\/apps\/auth\/login\?app=audit_sound/.test(lastUrl), 'pega a {base}/apps/auth/login?app=audit_sound (con /api/v1)');
ok(/username=dj/.test(lastBody) && /password=ok/.test(lastBody), 'credenciales en el cuerpo (no en la URL)');
ok(r.passwordResetRequired === true, 'password_reset_required propagado');
ok(CC.isAuthed() && CC.session().apps.includes('audit_sound'), 'sesión guardada con apps');
CC.logout();

// 4) Errores.
r = await CC.login('dj', 'mala', true);
ok(!r.ok && /incorrect/i.test(r.error), '401 credenciales → error');
r = await CC.login('sinapp', 'ok', true);
ok(!r.ok && /acceso/i.test(r.error), '403 app_forbidden → mensaje de sin acceso a la app');

console.log(`\nRESULTADO: ${P} OK, ${F} FAIL`);
srv.close(); process.exit(F ? 1 : 0);

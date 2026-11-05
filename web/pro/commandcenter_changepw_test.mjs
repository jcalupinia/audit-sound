// Pruebas del cambio de clave propio del cliente (commandcenter.changePassword)
// contra el endpoint /apps/auth/change-password del Command Center. Backend simulado.
import http from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let lastBody = null, lastAuth = '';
const srv = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  let raw = ''; req.on('data', c => raw += c);
  req.on('end', () => {
    if (req.method === 'POST' && req.url.startsWith('/api/v1/apps/auth/login')) {
      const p = new URLSearchParams(raw);
      if (p.get('username') === 'dj' && p.get('password') === 'temp1234')
        return send(200, { access_token: 'TKN', apps: ['audit_sound'], password_reset_required: true });
      return send(401, { detail: 'bad' });
    }
    if (req.method === 'POST' && req.url === '/api/v1/apps/auth/change-password') {
      lastAuth = req.headers['authorization'] || '';
      let j = {}; try { j = JSON.parse(raw || '{}'); } catch (e) {}
      lastBody = j;
      if (lastAuth !== 'Bearer TKN') return send(401, { detail: 'no autorizado' });
      if (j.current_password !== 'temp1234') return send(400, { detail: 'La contraseña actual no es correcta.' });
      return send(200, { email: 'dj', apps: ['audit_sound'], password_reset_required: false });
    }
    send(404, {});
  });
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port + '/api/v1';

const store = {};
globalThis.window = globalThis;
globalThis.localStorage = { getItem: k => k in store ? store[k] : null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const CC = await import(pathToFileURL(path.join(HERE, 'commandcenter.js')).href);
let P = 0, F = 0; const ok = (c, m) => { if (c) { P++; console.log('  OK  ' + m); } else { F++; console.log('  FAIL ' + m); } };

ok(CC.changePasswordPath() === '/apps/auth/change-password', 'changePasswordPath por defecto');

// Sin sesión -> error (no token)
window.AUDIT_SOUND_CC_API = base;
let r = await CC.changePassword('temp1234', 'NuevaClave123');
ok(!r.ok && /sesión/i.test(r.error), 'sin sesión -> pide iniciar sesión');

// Inicia sesión (clave temporal) para obtener token
r = await CC.login('dj', 'temp1234', true);
ok(r.ok && r.passwordResetRequired === true, 'login OK con reset requerido');

// Validaciones de cliente
ok(!(await CC.changePassword('', 'NuevaClave123')).ok, 'falta clave actual -> error');
ok(!(await CC.changePassword('temp1234', 'corta')).ok, 'clave nueva <8 -> error');

// Clave actual incorrecta -> 400 del backend
r = await CC.changePassword('mala', 'NuevaClave123');
ok(!r.ok && /actual/i.test(r.error), 'clave actual incorrecta -> mensaje del backend');

// Cambio correcto -> ok, y manda current+new al backend con Bearer
r = await CC.changePassword('temp1234', 'NuevaClave123');
ok(r.ok, 'cambio de clave OK');
ok(lastBody && lastBody.current_password === 'temp1234' && lastBody.new_password === 'NuevaClave123', 'envía current+new');
ok(lastAuth === 'Bearer TKN', 'envía el token Bearer');

// Sin backend configurado -> demo (no rompe)
window.AUDIT_SOUND_CC_API = '';
r = await CC.changePassword('a', 'NuevaClave123');
ok(r.ok && r.demo === true, 'sin backend -> demo no rompe');

console.log(`\nRESULTADO: ${P} OK, ${F} FAIL`);
srv.close(); process.exit(F ? 1 : 0);

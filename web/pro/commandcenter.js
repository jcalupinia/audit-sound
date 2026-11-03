// Cliente de autenticación de AUDIT SOUND ligado al Command Center (AuditBrain).
// El login reutiliza los usuarios/claves que ya se crean en el Command Center.
//
// Integración (backend más adelante): define la URL del Command Center en
//   window.AUDIT_SOUND_CC_API   (p. ej. "https://api.audit-ia.ec")  -> config.js
// y, si aplica, el path del login en window.AUDIT_SOUND_CC_LOGIN_PATH
// (por defecto "/client/auth/login", el portal de clientes de AuditBrain).
//
// Mientras no haya backend conectado, cae a un MODO DEMO (cualquier usuario/clave
// entra) para poder navegar el front; se avisa en la pantalla. Cuando el endpoint
// real responda, se usa ese y se guarda el token de sesión.

const LS_TOKEN = 'auditsound.cc.token';
const LS_USER = 'auditsound.cc.user';

export function apiBase() {
  const b = (typeof window !== 'undefined' && window.AUDIT_SOUND_CC_API) || '';
  return String(b).replace(/\/+$/, '');
}
export function configured() { return !!apiBase(); }

export function loginPath() {
  return (typeof window !== 'undefined' && window.AUDIT_SOUND_CC_LOGIN_PATH) || '/client/auth/login';
}
export function mePath() {
  return (typeof window !== 'undefined' && window.AUDIT_SOUND_CC_ME_PATH) || '/client/auth/me';
}

export function session() {
  try { return { token: localStorage.getItem(LS_TOKEN) || '', user: localStorage.getItem(LS_USER) || '' }; }
  catch (e) { return { token: '', user: '' }; }
}
export function isAuthed() { return !!session().token; }
export function logout() {
  try { localStorage.removeItem(LS_TOKEN); localStorage.removeItem(LS_USER); } catch (e) {}
}
function save(token, user, remember) {
  try {
    (remember ? localStorage : sessionStorage).setItem(LS_TOKEN, token);
    (remember ? localStorage : sessionStorage).setItem(LS_USER, user);
    // también en localStorage para que la consola lo lea de forma uniforme
    localStorage.setItem(LS_TOKEN, token); localStorage.setItem(LS_USER, user);
  } catch (e) {}
}

// Devuelve { ok, token, user, demo, error, passwordResetRequired }.
//
// Contrato real del Command Center (backend auditbrain-python-runner,
// POST /client/auth/login): cuerpo form-urlencoded (OAuth2PasswordRequestForm)
// con `username` y `password`; respuesta 200 JSON { access_token, token_type,
// password_reset_required }. Errores: 401 credenciales, 409 { detail:{ code } }
// (session_in_use / device_unauthorized), 429 rate-limit. Requiere
// credentials:'include' para que viaje/guarde la cookie httponly `device_id`.
export async function login(user, password, remember) {
  user = String(user || '').trim();
  if (!user || !password) return { ok: false, error: 'Escribe usuario y contraseña.' };

  if (!configured()) {  // sin backend conectado todavía → modo demo para navegar el front
    const token = 'demo-' + Math.random().toString(36).slice(2);
    save(token, user, remember);
    return { ok: true, token, user, demo: true };
  }

  const url = apiBase() + loginPath();
  let res;
  try {
    const body = new URLSearchParams();
    body.set('username', user);
    body.set('password', password);
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      credentials: 'include',
    });
  } catch (e) {
    return { ok: false, error: 'No se pudo conectar con el Command Center: ' + (e.message || e) };
  }

  if (res.status === 401) return { ok: false, error: 'Usuario o contraseña incorrectos.' };
  if (res.status === 429) return { ok: false, error: 'Demasiados intentos. Espera 15 minutos o contacta a soporte.' };
  if (res.status === 409) {
    let code = '', msg = '';
    try { const d = (await res.json()).detail; if (d && typeof d === 'object') { code = d.code || ''; msg = d.message || ''; } } catch (e) {}
    if (code === 'session_in_use') return { ok: false, error: msg || 'Esta cuenta ya está en uso. Pide que cierren sesión («Salir») o espera unos minutos.' };
    if (code === 'device_unauthorized') return { ok: false, error: msg || 'Este dispositivo no está autorizado para esta cuenta. Solicita reseteo a soporte.' };
    return { ok: false, error: msg || 'La cuenta no puede iniciar sesión en este momento (409).' };
  }
  if (!res.ok) return { ok: false, error: 'El Command Center respondió HTTP ' + res.status + '.' };

  let j = {};
  try { j = await res.json(); } catch (e) {}
  const token = j.access_token || j.token || j.session_token || 'cc-session';
  save(token, user, remember);
  return { ok: true, token, user, passwordResetRequired: !!j.password_reset_required };
}

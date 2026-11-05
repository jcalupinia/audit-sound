// Cliente de autenticación de AUDIT SOUND ligado al Command Center (AuditBrain).
// El login usa las «Cuentas de Aplicaciones AUDIT-IA» que se crean en el Command
// Center (sección APP · Cuentas AUDIT-IA), con permiso por app.
//
// Integración: define la URL del Command Center en
//   window.AUDIT_SOUND_CC_API   (p. ej. "https://api.audit-ia.ec")  -> config.js
// Opcionales:
//   window.AUDIT_SOUND_CC_LOGIN_PATH (por defecto "/apps/auth/login")
//   window.AUDIT_SOUND_CC_ME_PATH    (por defecto "/apps/auth/me")
//   window.AUDIT_SOUND_CC_APP        (clave de la app; por defecto "audit_sound")
//
// Contrato del endpoint (backend auditbrain-python-runner, POST /apps/auth/login):
// cuerpo form-urlencoded (OAuth2PasswordRequestForm) con `username` y `password`, y
// el query `?app=audit_sound` que valida el acceso a ESTA app. Respuesta 200 JSON
// { access_token, token_type, apps, password_reset_required }. Errores: 401
// credenciales, 403 { detail:{ code:"app_forbidden" } } (cuenta sin acceso a la app),
// 429 rate-limit. El token va luego en Authorization: Bearer (no usa cookie).
//
// Mientras no haya backend conectado, cae a un MODO DEMO (cualquier usuario/clave
// entra) para poder navegar el front; se avisa en la pantalla.

const LS_TOKEN = 'auditsound.cc.token';
const LS_USER = 'auditsound.cc.user';
const LS_APPS = 'auditsound.cc.apps';

export function apiBase() {
  const b = (typeof window !== 'undefined' && window.AUDIT_SOUND_CC_API) || '';
  return String(b).replace(/\/+$/, '');
}
export function configured() { return !!apiBase(); }

export function appKey() {
  return (typeof window !== 'undefined' && window.AUDIT_SOUND_CC_APP) || 'audit_sound';
}
export function loginPath() {
  return (typeof window !== 'undefined' && window.AUDIT_SOUND_CC_LOGIN_PATH) || '/apps/auth/login';
}
export function mePath() {
  return (typeof window !== 'undefined' && window.AUDIT_SOUND_CC_ME_PATH) || '/apps/auth/me';
}
export function changePasswordPath() {
  return (typeof window !== 'undefined' && window.AUDIT_SOUND_CC_CHANGE_PATH) || '/apps/auth/change-password';
}

export function session() {
  try {
    return {
      token: localStorage.getItem(LS_TOKEN) || '',
      user: localStorage.getItem(LS_USER) || '',
      apps: JSON.parse(localStorage.getItem(LS_APPS) || '[]'),
    };
  } catch (e) { return { token: '', user: '', apps: [] }; }
}
export function isAuthed() { return !!session().token; }
export function logout() {
  try { localStorage.removeItem(LS_TOKEN); localStorage.removeItem(LS_USER); localStorage.removeItem(LS_APPS); } catch (e) {}
}
function save(token, user, apps, remember) {
  try {
    const store = remember ? localStorage : sessionStorage;
    store.setItem(LS_TOKEN, token); store.setItem(LS_USER, user);
    // también en localStorage para que la consola lo lea de forma uniforme
    localStorage.setItem(LS_TOKEN, token);
    localStorage.setItem(LS_USER, user);
    localStorage.setItem(LS_APPS, JSON.stringify(apps || []));
  } catch (e) {}
}

// Devuelve { ok, token, user, apps, demo, error, passwordResetRequired }.
export async function login(user, password, remember) {
  user = String(user || '').trim();
  if (!user || !password) return { ok: false, error: 'Escribe usuario y contraseña.' };

  if (!configured()) {  // sin backend conectado todavía → modo demo para navegar el front
    const token = 'demo-' + Math.random().toString(36).slice(2);
    save(token, user, [appKey()], remember);
    return { ok: true, token, user, apps: [appKey()], demo: true };
  }

  // `?app=` valida que la cuenta tenga acceso a AUDIT SOUND.
  const url = apiBase() + loginPath() + '?app=' + encodeURIComponent(appKey());
  let res;
  try {
    const body = new URLSearchParams();
    body.set('username', user);
    body.set('password', password);
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (e) {
    return { ok: false, error: 'No se pudo conectar con el Command Center: ' + (e.message || e) };
  }

  if (res.status === 401) return { ok: false, error: 'Usuario o contraseña incorrectos.' };
  if (res.status === 429) return { ok: false, error: 'Demasiados intentos. Espera unos minutos.' };
  if (res.status === 403) {
    let msg = '';
    try { const d = (await res.json()).detail; msg = (d && typeof d === 'object') ? d.message : ''; } catch (e) {}
    return { ok: false, error: msg || 'Tu cuenta no tiene acceso a AUDIT SOUND. Pide al administrador que la habilite.' };
  }
  if (!res.ok) return { ok: false, error: 'El Command Center respondió HTTP ' + res.status + '.' };

  let j = {};
  try { j = await res.json(); } catch (e) {}
  const token = j.access_token || j.token || 'cc-session';
  const apps = Array.isArray(j.apps) ? j.apps : [];
  save(token, user, apps, remember);
  return { ok: true, token, user, apps, passwordResetRequired: !!j.password_reset_required };
}

// El cliente cambia su propia contraseña desde AUDIT SOUND (no necesita entrar al
// Command Center). Devuelve { ok, error, demo }.
export async function changePassword(currentPassword, newPassword) {
  if (!currentPassword || !newPassword) return { ok: false, error: 'Escribe la clave actual y la nueva.' };
  if (String(newPassword).length < 8) return { ok: false, error: 'La nueva clave debe tener al menos 8 caracteres.' };

  const { token } = session();
  if (!token) return { ok: false, error: 'Tu sesión expiró. Vuelve a iniciar sesión.' };

  if (!configured()) {  // modo demo / sin backend: no hay dónde cambiarla de verdad
    return { ok: true, demo: true };
  }

  let res;
  try {
    res = await fetch(apiBase() + changePasswordPath(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
  } catch (e) {
    return { ok: false, error: 'No se pudo conectar con el Command Center: ' + (e.message || e) };
  }

  if (res.status === 401) { logout(); return { ok: false, error: 'Tu sesión expiró. Vuelve a iniciar sesión.' }; }
  if (res.status === 400) {
    let msg = '';
    try { const d = (await res.json()).detail; msg = (typeof d === 'string') ? d : (d && d.message) || ''; } catch (e) {}
    return { ok: false, error: msg || 'No se pudo cambiar la contraseña. Revisa la clave actual.' };
  }
  if (!res.ok) return { ok: false, error: 'El Command Center respondió HTTP ' + res.status + '.' };
  return { ok: true };
}

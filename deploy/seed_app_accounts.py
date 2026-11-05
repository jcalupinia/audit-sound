#!/usr/bin/env python3
"""Crea las CUENTAS DE PRUEBA de AUDIT SOUND en el Command Center (AuditBrain).

Usa la API de administración de las «Cuentas de Aplicaciones AUDIT-IA»
(`auditbrain-python-runner`): inicia sesión como operador admin, crea cada cuenta
y marca la app AUDIT SOUND según corresponda. Imprime la clave temporal que el
backend genera para cada cuenta (se muestra UNA sola vez: guárdala).

Solo stdlib de Python 3 (no requiere pip). Las credenciales del admin se leen de
variables de entorno: NUNCA van escritas en este archivo.

Uso típico (contra tu entorno; NO producción a ciegas):

    export CC_ADMIN_EMAIL="tu-admin@audit-ia.ec"
    export CC_ADMIN_PASSWORD="********"
    python3 deploy/seed_app_accounts.py --base https://api.audit-ia.ec/api/v1

Opciones:
    --base           Base del backend INCLUYENDO /api/v1 (o env CC_API_BASE).
    --admin-email    Correo del operador admin (o env CC_ADMIN_EMAIL).
    --admin-password Clave del operador admin (o env CC_ADMIN_PASSWORD).
    --dry-run        No llama a la red; solo muestra qué cuentas crearía.

La matriz de prueba que dejan estas 4 cuentas:
  - dj.demo / cliente.salon  (con AUDIT SOUND)  -> login OK (200)
  - sin.acceso               (sin ninguna app)  -> 403 app_forbidden
  - inactivo                 (AUDIT SOUND, pero desactivada) -> 401
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE = "https://api.audit-ia.ec/api/v1"

# (email, nombre a mostrar, etiqueta de cliente, apps, activa)
ACCOUNTS = [
    ("dj.demo@audit-ia.ec",       "DJ Demo",               "AuditConsulting (interno)", ["audit_sound"], True),
    ("cliente.salon@audit-ia.ec", "Salón de Eventos Demo", "Cliente piloto",            ["audit_sound"], True),
    ("sin.acceso@audit-ia.ec",    "Cuenta sin app",        "Prueba de permisos",        [],              True),
    ("inactivo@audit-ia.ec",      "Cuenta inactiva",       "Prueba de estado",          ["audit_sound"], False),
]


def _req(method, url, token=None, data=None, form=False, timeout=30):
    headers = {}
    body = None
    if form:
        body = urllib.parse.urlencode(data).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read().decode() or "{}"
            return r.status, (json.loads(txt) if txt.strip() else {})
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode() or "{}")
        except Exception:
            payload = {}
        return e.code, payload
    except urllib.error.URLError as e:
        return 0, {"_error": str(e)}


def main():
    ap = argparse.ArgumentParser(description="Crea las cuentas de prueba de AUDIT SOUND en el Command Center.")
    ap.add_argument("--base", default=os.environ.get("CC_API_BASE", DEFAULT_BASE),
                    help="Base del backend incluyendo /api/v1 (env CC_API_BASE).")
    ap.add_argument("--admin-email", default=os.environ.get("CC_ADMIN_EMAIL"),
                    help="Correo del operador admin (env CC_ADMIN_EMAIL).")
    ap.add_argument("--admin-password", default=os.environ.get("CC_ADMIN_PASSWORD"),
                    help="Clave del operador admin (env CC_ADMIN_PASSWORD).")
    ap.add_argument("--dry-run", action="store_true", help="No llama a la red; muestra el plan.")
    args = ap.parse_args()

    base = args.base.rstrip("/")

    print(f"Command Center: {base}")
    print("Cuentas a crear:")
    for email, name, label, apps, active in ACCOUNTS:
        print(f"  - {email:30s} | app AUDIT SOUND: {'sí' if apps else 'NO':3s} | "
              f"{'ACTIVA' if active else 'INACTIVA'} | {name} ({label})")

    if args.dry_run:
        print("\n[--dry-run] No se llamó a la red. Nada creado.")
        return 0

    if not args.admin_email or not args.admin_password:
        sys.exit("\nERROR: faltan credenciales de admin. Define CC_ADMIN_EMAIL y CC_ADMIN_PASSWORD "
                 "(o pásalas con --admin-email/--admin-password).")

    # 1) Login de admin (OAuth2 password: username = email).
    st, tok = _req("POST", base + "/auth/login", form=True,
                   data={"username": args.admin_email, "password": args.admin_password})
    if st != 200 or "access_token" not in tok:
        sys.exit(f"\nERROR: login de admin falló (HTTP {st}): {tok}")
    token = tok["access_token"]
    if tok.get("role") != "admin":
        print(f"\nAVISO: el rol devuelto es {tok.get('role')!r}; la creación exige rol 'admin' y puede dar 403.")

    # 2) Crear cada cuenta.
    print("\nResultados:\n")
    rows = []
    for email, name, label, apps, active in ACCOUNTS:
        st, body = _req("POST", base + "/apps/accounts", token=token,
                        data={"email": email, "display_name": name,
                              "client_label": label, "apps": apps})
        if st == 201:
            acct = body.get("account", {})
            temp = body.get("temp_password", "")
            note = ""
            if not active:
                sid = acct.get("id")
                pst, _ = _req("PATCH", f"{base}/apps/accounts/{sid}", token=token,
                              data={"is_active": False})
                note = "desactivada" if pst == 200 else f"NO se pudo desactivar (HTTP {pst})"
            rows.append((email, temp, "creada" + (f" · {note}" if note else "")))
        elif st == 400 and "ya existe" in json.dumps(body, ensure_ascii=False).lower():
            rows.append((email, "(ya existía — usa «Restablecer clave» en el Command Center)", "omitida"))
        else:
            rows.append((email, f"ERROR HTTP {st}: {json.dumps(body, ensure_ascii=False)}", "falló"))

    width = max(len(r[0]) for r in rows)
    for email, temp, estado in rows:
        print(f"  {email:<{width}}  [{estado}]")
        print(f"  {'':<{width}}  clave temporal: {temp}")
    print("\nIMPORTANTE: las claves temporales se muestran UNA vez. Cópialas ahora.")
    print("Prueba el login en  {}/apps/auth/login?app=audit_sound  (o en la consola de AUDIT SOUND).".format(base))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

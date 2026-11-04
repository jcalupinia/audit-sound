# A1 — Cierre de pendientes: failover, WASM en CI, móvil y proxy

Rama `claude/etapa-a-seguimiento` (sobre la base con la Etapa A ya fusionada).
Toda cifra proviene de una ejecución real en el contenedor Linux de la sesión.

## A1.4 — Reproducción continua + recuperación ante fallos

`tools/playback_recovery_test.cpp` (en CI). Arranca el motor (OfflineSink, headless)
y el AutoMix con un proveedor de pistas que **falla una de cada dos** (rutas
inexistentes). Resultado:

```
muestras=40 sonando=40 (100%) huecos=0 · buenas servidas=9 malas servidas=8
OK la fuente falló al menos una vez (se ejercitó la recuperación)
OK se sirvieron pistas buenas tras los fallos (recuperación)
OK se reprodujeron ambas pistas buenas
OK reproducción continua ≥90% del tiempo pese a los fallos
OK sin cuelgue ni caída
RESULTADO: 5 OK, 0 FAIL
```

El AutoMix se recuperó de **8 fallos** de fuente manteniendo **100 % de continuidad**
a lo largo de las transiciones (mecanismo `loadIntoRetry`: salta la pista que no carga).

## WASM en CI

Nuevo job `wasm` en `.github/workflows/ci.yml` con `mymindstorm/setup-emsdk@v14`
(emcc **6.0.13**) que compila `cmake --build wasm/build` **completo**
(`audit_engine` + `audit_selftest`) y comprueba los artefactos. Antes el WASM no
estaba cubierto por CI. El build completo ya se verificó localmente (artefacto
`audit_engine.wasm` byte-idéntico al del frontend).

## A1.6 — Compatibilidad móvil (emulación; **no** dispositivo físico)

Dos mejoras + verificación por emulación (Playwright, 11/11):

1. **Guard de capacidades en la consola PRO** (`web/pro/console.js`): si falta el
   aislamiento de origen (COOP/COEP → SharedArrayBuffer) o AudioWorklet —caso de
   iPhone/Safari—, la pantalla de inicio **avisa** («el motor de mezcla no está
   disponible; usa la página de escucha») en vez de fallar a ciegas.
2. **Página de escucha** (`web/index.html`): ya trae `<audio playsinline>` + Media
   Session (controles de pantalla bloqueada), pensada para iOS.

Evidencia (emulación iPhone 13 y Pixel 5):

```
[iPhone 13] render OK · playsinline OK · mediaSession OK · sin scroll horizontal
[Pixel 5]   render OK · playsinline OK · mediaSession OK · sin scroll horizontal
[consola PRO iPhone] crossOriginIsolated=false → muestra el aviso y no arranca a ciegas
RESULTADO: 11 OK, 0 FAIL
```

> **Límite honesto:** esto es **emulación de navegador**, no una prueba en hardware
> real. La validación física en un iPhone/Android del cliente sigue siendo una prueba
> manual del equipo. No se afirma lo que no se probó en un dispositivo real.

## Jamendo / Internet Archive — prueba del proxy (sin clave real)

`deploy/pro/proxy_test.mjs`: arranca `server.js` contra un **upstream simulado** y
verifica la normalización y la seguridad del proxy (lo que corre en producción):

```
OK Jamendo search → resultados normalizados (id,title,artist,license,audio)
OK Jamendo audio (host permitido) → bytes
OK Jamendo audio (host NO permitido) → 403 (lista blanca)
OK Archive search → resultados normalizados (id,title,artist,license)
OK Archive audio (id válido) → bytes (metadata→download)
OK Archive audio (id inválido) → 400 (validación)
RESULTADO: 6 OK, 0 FAIL
```

> **Pendiente real-API (acción del equipo):** la prueba contra las **APIs reales**
> de Jamendo/Archive requiere `JAMENDO_CLIENT_ID` + salida de red a esos hosts; se
> corre en el **preview desplegado**:
> 1. En el servicio PRO (Coolify): definir `JAMENDO_CLIENT_ID` (y, si se quiere,
>    `ARCHIVE_ENABLED=true`, ya por defecto).
> 2. En la consola: buscar un término real → deben aparecer resultados de Jamendo
>    (CC) y de Archive, cargables a los decks según su disponibilidad.
> El camino del proxy y su normalización/seguridad ya están verificados aquí con mock.

## Estado de A1 tras este cierre

| Ítem | Estado |
|---|---|
| Compilación nativa + WASM | OK (WASM ahora también en CI) |
| Control API endurecido | OK (12/12 en CI) |
| Reproducción continua + failover | OK (5/5 en CI) |
| Selector / arranque motor | OK (en CI) |
| Compatibilidad móvil | Emulación OK; **física pendiente (manual)** |
| Jamendo/Archive | Proxy OK (mock); **real-API pendiente (clave + red)** |

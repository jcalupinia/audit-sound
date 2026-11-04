# A2 — Evidencia de pruebas, integración y regresión

Rama `claude/etapa-a`. Entorno: contenedor Linux de la sesión (no producción).
Verificación del buscador unificado (A2) y su integración con el motor WASM y la
biblioteca. Toda cifra proviene de una ejecución real.

## 1. Pruebas unitarias de `search.js` (Node, 14/14 OK)

Núcleo del buscador sin navegador (`node search_test.mjs`):

```
OK fmtDuration
OK archive sin licencia → consultar
OK archive all rights → consultar
OK archive public domain → mezclar
OK archive CC BY-SA → mezclar
OK archive CC BY-NC → previsualizar
OK normLocal separa artista/título y sin extensión
OK dedupe cruzado conserva mayor disponibilidad + alsoIn
OK dedupe exacto por (source,id)
OK searchAll: un proveedor falla, el otro devuelve resultados
OK searchAll: bySource refleja OK y error
OK searchAll: timeout acota al proveedor lento (301ms) y devuelve el rápido
OK searchAll: filtro only=[navidrome]
OK searchAll: proveedor deshabilitado se omite
RESULTADO: 14 OK, 0 FAIL
```

## 2. Evidencia por proveedor (búsqueda)

La búsqueda unificada se probó con proveedores simulados que emulan el contrato real
de cada módulo (shape de resultado y errores). Resultado del estado de búsqueda:

```
4 resultado(s) (2 navidrome, 1 libre, 2 archive) · FuenteRota: error
```

- **Navidrome**: 2 resultados (incluye la ruta de género `getSongsByGenre`).
- **Libre (Jamendo)**: 1 resultado, licencia CC → mezclar.
- **Archive**: 2 resultados — uno "All Rights Reserved" → *solo consultar*; otro
  "CC BY-NC" → *previsualizar*.
- **Fuente que falla**: capturada y reportada sin tumbar al resto.

> Nota: no se consultó la API real de Jamendo/Archive en esta sesión (requieren clave
> y red saliente a esos hosts; en producción van por el proxy `deploy/pro/server.js`).
> El contrato de cada módulo ya estaba verificado en etapas previas (PR #17/#18) con
> mocks del propio proxy. Aquí se verifica el **buscador unificado** sobre ese contrato.

## 3. Integración con los decks (E2E Playwright, 7/7 OK)

Consola real servida con COOP/COEP; motor WASM iniciado:

```
pos antes/después de buscar: 0.77 → 2.77 (sigue sonando: true)
resultados: 4
OK dedup → 4 tiles (común fusiona navidrome+libre)
OK común es mezclar y muestra +1 (alsoIn)
OK Reservada → solo consultar (A/B off, sin +cola)
OK No Comercial → previsualizar (botón oír, sin +cola/guardar)
OK status reporta la fuente rota
OK audio NO se bloqueó durante la búsqueda (p2>p1)
resultados locales: ["Tema Local"]
titleB tras cargar resultado local: Artista Local - Tema Local.wav
OK cargar resultado de búsqueda al deck B
ERRORES: ninguno
```

- **Carga a deck**: un resultado de búsqueda (biblioteca local, importada en la prueba)
  se cargó al **deck B** (bytes reales, motor WASM).
- **Hilo de audio no bloqueado** (A3): la pista del deck A avanzó de 0,77 s a 2,77 s
  **mientras sonaba** y durante la búsqueda (incluyó un proveedor lento de 700 ms).
- **Diferenciación de disponibilidad** reflejada en la UI (acciones habilitadas/no).

## 4. Regresión del motor y seguridad (no afectada por A2)

A2 es frontend (JS); no toca el motor nativo ni el Control API. Se re-corrieron las
pruebas del motor para confirmar que no hay regresión:

- Build nativo Release: **OK**.
- `engine_selftest`: **OK**.
- `selector_test`: **OK** (99,2 % armónico, 0 repeticiones).
- `control_api_test`: **12/12 OK** (endurecimiento A1.3).
- Build WASM completo (`audit_engine` + `audit_selftest`): **OK**.
- Consola WASM (Playwright): arranque + carga de pista + waveform: **OK**.

## 5. Diferencias documentadas (buscador ↔ motor ↔ biblioteca del servidor)

- El **buscador vive en el navegador** (consola `/pro/`); la **biblioteca del servidor**
  (motor autónomo del streaming) es independiente y se alimenta por `AUDIT_SOUND_MUSIC_DIR`
  / Subsonic del lado servidor. Son dos caminos distintos por diseño:
  - Consola PRO (navegador): mezcla en el cliente con WebCodecs/WASM; el buscador carga
    bytes a los decks del navegador.
  - Motor del servidor (Modo C streaming): reproduce su propia carpeta/Subsonic y emite
    por Icecast; no usa este buscador.
- La **cola** del buscador es el selector del AutoMix del **motor del navegador**
  (`bridge.autoAdd`), no la del motor del servidor.

## 6. Limitaciones y pendientes

- No se validó contra las **APIs reales** de Jamendo/Archive en esta sesión (sin clave
  ni red a esos hosts); sí el contrato vía mocks y el buscador unificado sobre él.
- Compatibilidad **física móvil** no probada (A1.6).
- El gancho `window.__AS_PROVIDERS_OVERRIDE` en `console.js` es un punto de inyección de
  pruebas, **inerte en producción** (solo actúa si la página define ese global).

# A4-02 — Buscador musical unificado (validación)

Archivos: `web/pro/search.js`, `web/pro/console.js`, `web/pro/{openmusic,archive,subsonic}.js`.
Pruebas: `web/pro/search_test.mjs` (Node, **18/18**) + E2E en consola (Playwright, 6/6).

## A — Clasificación de licencias por pista

- `classifyLicense(license, unknownDefault)` evalúa **cada** licencia:
  - CC BY / BY-SA / dominio público / CC0 → **mezclar**.
  - CC BY-NC / BY-ND (restricciones **NC**/**ND**) → **previsualizar** (chip visible).
  - Licencia desconocida → conservador: Jamendo **previsualizar**, Archive **consultar**.
  - "All rights reserved" → **consultar**.
- `normLibre()` ya **no** marca todas las pistas de Jamendo como mezclar.
- La disponibilidad (reproducción/mezcla) y la licencia se muestran por separado en el
  tile (badge de disponibilidad + chips NC/ND + etiqueta de licencia en el tooltip).
- Evidencia unitaria: `normLibre con NC → previsualizar (no mezclar)`, `con BY → mezclar`.
- Evidencia E2E: `Noche (CC BY-NC) → previsualizar + chip NC`, `Tarde (ND) → chip ND`.

## B — Deduplicación que no fusiona grabaciones distintas

- Clave: artista + **título base** (sin coletilla de versión) + **etiqueta de versión**
  (`versionTag`: remix/live/remaster/acoustic/radio/extended/instrumental/karaoke).
- Dos entradas solo se fusionan si además el **álbum** es compatible (igual o desconocido)
  y la **duración** no difiere más de 3 s. Dedup exacta por `(source, id)` + `alsoIn`.
- Evidencia: `no fusiona original vs remix`, `álbumes distintos`, `duraciones distintas`,
  y `fusiona la MISMA grabación entre fuentes conservando la mayor disponibilidad`.

## C — Cancelación de búsquedas

- `searchAll(query, { signal })` acepta `AbortSignal` y lo pasa a los proveedores; los
  módulos `openmusic/archive/subsonic` reenvían `signal` a `fetch`.
- `console.js` cancela la búsqueda anterior (`AbortController`) y **descarta respuestas
  obsoletas por epoch** (protección contra respuestas fuera de orden).
- Timeouts **independientes** por proveedor; **tope de resultados** (`maxTotal`, 200).
- Evidencia: `searchAll rechaza con AbortError al cancelar`, `aplica el tope de resultados`.

## D — Integración funcional (consola)

Cada resultado autorizado puede, según su disponibilidad:
- **mezclar**: cargar a deck A/B, `+cola` (DJ automático), guardar en biblioteca.
- **previsualizar**: `🎧 oír` (cargar al deck libre), sin encolar/guardar.
- **consultar**: acciones deshabilitadas (solo metadatos).
- Conecta con los modos Manual/Híbrido (carga a decks) y Automático (`+cola`, «Armar set»
  usa solo lo apto para mezclar). **La búsqueda nunca detiene la pista que suena**
  (verificado: el deck A avanzó durante la búsqueda).

## Resultado

Unitarias **18/18**; E2E **6/6** (licencias BY/NC/ND/all-rights con chips, remix no
fusionado, audio no bloqueado, sin errores de consola).

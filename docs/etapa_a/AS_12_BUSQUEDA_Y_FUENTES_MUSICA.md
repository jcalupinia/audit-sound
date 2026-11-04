# AS-12 — Búsqueda y fuentes de música (buscador unificado)

Etapa A / Frente A2. Módulo nuevo: `web/pro/search.js`; integración en
`web/pro/console.js` + `web/pro/console.html`. Reutiliza (sin duplicar) los módulos
existentes `subsonic.js`, `openmusic.js`, `archive.js`, `library.js` y el proxy
`deploy/pro/server.js`.

## 1. Qué hace

Una **única barra de búsqueda** consulta las fuentes **habilitadas en paralelo** y
presenta resultados homogéneos con **título, artista, álbum, duración, fuente y
disponibilidad**, deduplicados y filtrables por fuente. Diferencia claramente la
música apta para **mezclar**, **previsualizar** o **solo consultar**, y permite
cargarla a los decks A/B, encolarla (DJ automático) o guardarla.

## 2. Fuentes y disponibilidad (ver matriz de licencias)

| Fuente | Módulo | Búsqueda | Disponibilidad por defecto |
|---|---|---|---|
| Navidrome/Subsonic | `subsonic.js` | `search3` + `getSongsByGenre` (género) | mezclar |
| Jamendo (Libre) | `openmusic.js` + proxy | artista/título/estilo | mezclar (CC) |
| Internet Archive | `archive.js` + proxy | artista/título/colección | **según licencia** (consultar · previsualizar · mezclar) |
| Biblioteca local | `library.js` | nombre (IndexedDB) | mezclar |

La disponibilidad de Internet Archive la decide `archiveAvailability(license)` de forma
**conservadora**: dominio público / CC-BY(-SA) → *mezclar*; CC-NC/ND u otra licencia
no clasificada → *previsualizar*; "all rights reserved" o licencia desconocida →
*solo consultar*. **Nunca** se asume dominio público.

## 3. Arquitectura (`search.js`)

- **Normalizadores puros** por fuente (`normNavidrome/normLibre/normArchive/normLocal`)
  → forma común `{source, id, title, artist, album, duration, license, availability,
  filename, _raw}`.
- **`searchAll(query, {providers, only, perSource, timeoutMs})`**: ejecuta los
  proveedores habilitados con `Promise.allSettled` (uno que falle **no** tumba al
  resto), aplica **timeout por proveedor**, **deduplica** y devuelve
  `{results, errors, bySource}`. `only` filtra por fuente.
- **Deduplicación**: exacta por `source::id` y **cruzada** por `título+artista`
  normalizados; entre duplicados se conserva el de **mayor disponibilidad**
  (mezclar > previsualizar > consultar) y se anota en `alsoIn` las otras fuentes
  (se muestra como «+N» en el resultado).
- **No bloquea el audio**: son `fetch` asíncronos en el hilo principal; el motor de
  audio corre en su propio worklet/worker con SharedArrayBuffer, así que la
  reproducción continúa durante la búsqueda (verificado empíricamente).

## 4. Integración con la consola (`console.js`)

- La barra `#libQuery` dispara `doSearch()` (Enter o botón «Buscar»).
- Chips de fuente (`☁ Navidrome · ♪ Libre · 📚 Archive · 💾 Local`): atenuados si la
  fuente no está habilitada; seleccionar uno o varios limita la búsqueda (vacío = todas).
- Cada resultado (tile) muestra fuente, disponibilidad y duración, y ofrece:
  - **mezclar**: `▶A`, `▶B` (cargar al deck), `+cola` (`bridge.autoAdd` → DJ automático),
    `＋` (guardar en biblioteca local, con opción Opus 160).
  - **previsualizar**: `🎧 oír` (carga al deck libre para escuchar; sin encolar/guardar).
  - **solo consultar**: acciones deshabilitadas (solo metadatos).
- **Conexión con los modos**: cargar a A/B sirve a DJ Manual e Híbrido; `+cola` y
  «🎶 Armar set» alimentan el DJ Automático (el set toma solo lo apto para mezclar).
- **Cola musical**: la cola es el selector del AutoMix (`bridge.autoAdd`); «Armar set»
  pasa a modo auto y arranca al tener 2 pistas.

## 5. Manejo de errores, vacíos, límites y timeouts

- Resultado vacío → mensaje «Sin resultados. Prueba otro término o habilita más fuentes.»
- Error de un proveedor (conexión, 429 de API, 5xx) → se captura por proveedor y se
  informa en la línea de estado (`FuenteRota: error`), sin afectar a los demás.
- Timeout por proveedor (`timeoutMs`, 9 s por defecto) → ese proveedor se descarta y
  se informa «tardó demasiado»; el resto responde igual.
- La clave de Jamendo vive solo en el backend (proxy); el navegador nunca la ve.

## 6. Cumplimiento legal

No se descarga, extrae ni mezcla contenido sin disponibilidad declarada: Internet
Archive se trata como *consultar/previsualizar* salvo licencia permisiva explícita; la
licencia CC de Jamendo se respeta (atención a cláusulas NC en eventos comerciales); la
biblioteca local y Navidrome son contenido del propio usuario.

## 7. Pruebas (ver `A2_EVIDENCIA_Y_REGRESION.md`)

- Unitarias de `search.js` (Node, 14/14): normalizadores, disponibilidad, dedup,
  paralelo, timeout, errores, filtro por fuente.
- E2E en navegador (Playwright, 7/7): render de badges, dedup cruzado, errores,
  **audio no bloqueado**, carga de resultado a deck.

# Matriz de APIs y licencias musicales — AUDIT SOUND

Fuentes integradas hoy en el repo y su tratamiento legal/técnico. Base para el
buscador unificado (A2). Regla rectora: **no descargar, extraer ni mezclar contenido
sin autorización técnica y jurídica**; diferenciar siempre *mezclar* vs *previsualizar*
vs *solo consultar*.

| Fuente | Módulo | API / acceso | Clave | Búsqueda | Licencia del contenido | Uso permitido en la app |
|---|---|---|---|---|---|---|
| **Navidrome / Subsonic** | `web/pro/subsonic.js` | Subsonic API (`search3`, `getSongsByGenre`, `stream`/`download`) directo al servidor del usuario | Usuario+clave del propio servidor | título, artista, álbum, **género** | La que posea el usuario sobre **su** biblioteca | **Mezclar** (es música propia del usuario; responsabilidad del usuario) |
| **Jamendo (música libre)** | `web/pro/openmusic.js` + proxy `deploy/pro/server.js` (`/api/openmusic/*`) | Jamendo API v3 (proxy backend; clave server-side) | `JAMENDO_CLIENT_ID` (Coolify) | título, artista, estilo/tag | **Creative Commons** (varía por pista: BY, BY-SA, BY-NC…) | **Mezclar** respetando la licencia CC de cada pista (atribución; ojo con NC en eventos comerciales) |
| **Internet Archive** | `web/pro/archive.js` + proxy `deploy/pro/server.js` (`/api/archive/*`) | Advanced Search + Metadata (proxy backend) | Sin clave | título, artista, colección | **Varía**: dominio público, CC, y a veces *todos los derechos reservados* | **Previsualizar / consultar** por defecto; **mezclar solo** si la licencia del ítem lo permite (revisar por ítem) |
| **Biblioteca local** | `web/pro/library.js` (IndexedDB) | Local (navegador) | — | nombre/metadatos guardados | La que aporte el usuario al importar | **Mezclar** (archivos del propio usuario) |

## Notas de cumplimiento

- **Jamendo:** la licencia es por pista. El buscador debe mostrar la licencia (ya viene
  en `openmusic.js`) y, para uso comercial/eventos, advertir sobre cláusulas `NC`.
- **Internet Archive:** la disponibilidad legal **no es uniforme**. El buscador marcará
  estos resultados como *previsualizar/consultar* salvo que el ítem declare una licencia
  que permita la mezcla; nunca se asumirá dominio público.
- **Navidrome:** el contenido es del usuario; la app no distribuye, solo reproduce para
  el propio usuario en su cabina.
- **Backend como proxy:** Jamendo e Internet Archive pasan por `deploy/pro/server.js`
  con allowlist de hosts y tope de bytes; la clave de Jamendo nunca llega al navegador.

## Disponibilidad por capacidad (para el buscador A2)

| Fuente | Buscar | Previsualizar | Cargar en deck (mezclar) | Guardar en biblioteca |
|---|---|---|---|---|
| Navidrome | ✅ | ✅ (stream) | ✅ | ✅ |
| Jamendo | ✅ | ✅ | ✅ (según CC) | ✅ |
| Internet Archive | ✅ | ✅ | ⚠️ según licencia del ítem | ⚠️ según licencia |
| Local | ✅ | ✅ | ✅ | ✅ (ya está) |

Leyenda: ✅ permitido · ⚠️ condicionado a la licencia del ítem (revisión obligatoria).

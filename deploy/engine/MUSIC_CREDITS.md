# Créditos de música — biblioteca por defecto (libre de derechos)

Cuando `/music` está vacío y no hay fuente Subsonic, el stream usa una biblioteca
de deep/tech house con licencia **Creative Commons Attribution-ShareAlike 3.0
(CC BY-SA 3.0)**, incluida en la imagen del engine (`/cc-music`).

- Recopilación: «MNS006 V.A — Colores Paralelos»
- Netlabel: Monofónicos
- Fuente: https://archive.org/details/MNS006_VA--Colores_Paralelos
- Licencia: CC BY-SA 3.0 — https://creativecommons.org/licenses/by-sa/3.0/

Pistas incluidas (autor — título):

- Paulo Olarte — Cielos
- Ruido Selecto — Talisman
- Sir Leaks — Espejismo
- Deraout — Electricamente
- MALA — Bang It
- Vélez — Down By Law

Cada obra conserva su licencia CC BY-SA 3.0; la atribución corresponde a sus
autores y al netlabel Monofónicos. El stream muestra el autor y título de la
pista en reproducción ("ahora suena"), cumpliendo la atribución.

## Biblioteca latina (por defecto desde 2026-11-08)

Con `AUDIT_SOUND_BIBLIOTECA=latina` (valor por defecto) el stream usa estas pistas, guardadas en
`deploy/engine/cc-music-latina/` y copiadas a la imagen en `/cc-music-latina`. Todas vienen de
**Jamendo** con licencia Creative Commons que permite la difusión comercial (BY o BY-SA; se
descartaron las «NC» y las «ND»). `house` vuelve a la biblioteca de arriba y `todas` usa ambas.

| Archivo | Autor | Obra original en Jamendo | Licencia |
|---|---|---|---|
| Giovanny - Morena.mp3 | Giovanny | «Morena» · https://www.jamendo.com/track/1413255 | CC BY 3.0 |
| Los Cuban Boys - Reciclate, evaporate.mp3 | Los Cuban Boys | «Recíclate, evapórate, Rema que aquí no pican» · https://www.jamendo.com/track/1389077 | CC BY 3.0 |
| Juanitos - El Cha Cha Man.mp3 | Juanitos | «El Cha cha Man» · https://www.jamendo.com/track/37754 | CC BY 2.0 Francia |
| Xaviant Haze - Cuban Cigars.mp3 | Xaviant Haze | «CUBAN CIGARS» (álbum «Havana Mambo 2012») · https://www.jamendo.com/track/157738 | CC BY-SA 3.0 |
| Danna Ruiz - Alentando ilusiones.mp3 | Danna Ruiz | «Alentando ilusiones» · https://www.jamendo.com/track/1396086 | CC BY-SA 3.0 |
| El Gran Proyecto - Latino Soy.mp3 | EL GRAN PROYECTO | «LATINO SOY» · https://www.jamendo.com/track/357192 | CC BY 3.0 |
| Ronald Nunez - La Bachata Loca.mp3 | Ronald Nuñez | «La Bachata Loca» · https://www.jamendo.com/track/320095 | CC BY-SA 3.0 |

Licencias: https://creativecommons.org/licenses/by/3.0/ · https://creativecommons.org/licenses/by-sa/3.0/ ·
https://creativecommons.org/licenses/by/2.0/fr/

Los archivos son los MP3 de Jamendo sin modificar (solo se cambió el nombre del archivo para que el stream
anuncie «Autor - Título»). La licencia la declara cada autor al publicar en Jamendo; si un autor la cambia o
retira la obra, se quita de esta carpeta.

Para usar tu propia música, monta tus archivos en `/music` (volumen `audit_music`)
o configura una fuente Subsonic/Navidrome; cualquiera tiene prioridad sobre esta biblioteca.

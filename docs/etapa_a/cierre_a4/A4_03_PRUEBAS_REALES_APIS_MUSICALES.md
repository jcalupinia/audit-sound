# A4-03 — Pruebas de las APIs musicales

Se distinguen **categorías** de prueba (sin sustituir una por otra):

| Categoría | Jamendo | Internet Archive | Navidrome | Local |
|---|---|---|---|---|
| Unitaria (lógica) | ✅ `search_test.mjs` | ✅ | ✅ (normalizador) | ✅ |
| Proveedor simulado (mock) | ✅ `proxy_test.mjs` | ✅ `proxy_test.mjs` | — | n/a |
| Integración real (API externa) | ⛔ pendiente (clave+red) | ⛔ pendiente (red) | ⛔ pendiente (instancia) | ✅ (IndexedDB real) |
| Dispositivo físico | ⛔ manual | ⛔ manual | ⛔ manual | ⛔ manual |

## Prueba del proxy con upstream simulado (`deploy/pro/proxy_test.mjs`, 6/6)

Arranca `server.js` contra un upstream simulado que imita el contrato real de Jamendo
e Internet Archive, y verifica normalización + seguridad:

```
OK Jamendo search → resultados normalizados (id,title,artist,license,audio)
OK Jamendo audio (host permitido) → bytes
OK Jamendo audio (host NO permitido) → 403 (lista blanca)
OK Archive search → resultados normalizados (id,title,artist,license)
OK Archive audio (id válido) → bytes (metadata→download)
OK Archive audio (id inválido) → 400 (validación)
RESULTADO: 6 OK, 0 FAIL
```

## Integración REAL (pendiente — requiere acceso/credenciales autorizados)

> **No ejecutada en este entorno**: no hay `JAMENDO_CLIENT_ID` ni salida de red a esos
> hosts, y no hay una instancia de Navidrome de prueba autorizada. **No se declara
> éxito** de lo que no se ejecutó. En producción estas fuentes van por el proxy
> `deploy/pro/server.js`, ya verificado con mock.

**Para ejecutarla (acción del equipo, en el preview desplegado, sin producción):**
1. **Jamendo:** definir `JAMENDO_CLIENT_ID` en el servicio PRO; buscar un término real;
   deben aparecer pistas CC con su licencia por pista (BY/BY-SA → mezclar; NC/ND →
   previsualizar).
2. **Internet Archive:** ya activo por defecto; buscar y verificar que los ítems con
   "all rights reserved" quedan como *consultar* y los CC/PD como *mezclar/previsualizar*.
3. **Navidrome:** con una instancia de **prueba** autorizada (nunca producción ni
   biblioteca real sin permiso), configurar la conexión y validar búsqueda por
   artista/género + carga a deck.

No usar credenciales de producción ni modificar bibliotecas reales sin autorización.

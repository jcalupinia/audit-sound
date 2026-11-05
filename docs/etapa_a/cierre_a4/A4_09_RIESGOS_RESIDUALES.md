# A4-09 — Riesgos residuales

| # | Riesgo | Severidad | Estado / mitigación |
|---|---|---|---|
| R1 | Credenciales de `/api/login` viajan en el **cuerpo** POST sobre HTTP interno engine↔nginx | Baja | El engine no se publica (solo nginx lo alcanza); TLS lo da el proxy público. Mitigado por red interna + rate limit. |
| R2 | CORS requiere configurar `AUDIT_SOUND_API_ORIGIN` en el deploy | Baja | Deny-by-default; si no se configura, el navegador cross-origin queda bloqueado (seguro, pero hay que fijar el origen para usarlo cross-site). Documentado. |
| R3 | Spoofing de `X-Forwarded-For` si el engine se expone directamente | Baja | `AUDIT_SOUND_API_TRUST_PROXY=false` lo neutraliza; por defecto se confía (detrás de nginx). |
| R4 | Credencial de control **compartida** (no por persona) | Media (diseño) | Aceptado para el caso de uso de cabina; trazabilidad por persona exigiría usuarios individuales (fuera de alcance). |
| R5 | Clasificación de licencia por heurística de la URL/el texto CC | Baja-Media | Conservadora (desconocida → no mezclar); el criterio final de uso comercial (NC) es decisión del auditor. Puede refinarse con el catálogo de licencias del proveedor. |
| R6 | Reconexión de Icecast / fuga de memoria en larga duración **no** probadas automáticamente | Media | Requiere Icecast y ejecución prolongada; pendiente de prueba de integración (R-ext). |
| R7 | Validación con **APIs reales** (Jamendo/Archive) y **Navidrome** real no ejecutada aquí | Media | Camino del proxy verificado con mock; real requiere clave/red/instancia autorizadas (acción del equipo). |
| R8 | **Dispositivo físico** (iPhone/Android) no probado | Media | Emulación verificada; prueba física es intervención humana. |
| R9 | Gancho de pruebas `window.__AS_PROVIDERS_OVERRIDE` en `console.js` | Muy baja | Inerte en producción (solo actúa si la página define el global); útil para E2E. |

**Ninguno de severidad alta/crítica abierto en el código implementado.** Los riesgos de
mayor severidad (R6–R8) son **validaciones externas/físicas** dependientes de
infraestructura o hardware, no defectos del software entregado.

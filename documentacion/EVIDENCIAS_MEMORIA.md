# Evidencias para la memoria — Backend

## 1. Comandos que generan evidencia

```bash
npm install
npx prisma validate      # esquema OK
npx prisma generate      # cliente OK
npm run typecheck        # tsc --noEmit (exit 0)
npm run build            # tsc (exit 0)
npm test                 # 4 tests OK
```

## 2. Capturas recomendadas

| # | Captura | Sirve para |
|---|---------|------------|
| 1 | `npm run build` con exit 0 | Anexo H |
| 2 | `npm test` (4 passing) | Anexo H |
| 3 | `npx prisma validate` / `generate` | Anexo D (BD) |
| 4 | Payload BACK→IA con `user_context`, `weather_context`, `request_seed` | Anexo E/F |
| 5 | `ia_json` persistido con `engine_metadata` + `decision_trace` + `schedule` | Anexo E, Cap. 3 |
| 6 | Respuesta de `GET /api/itinerarios/:id/auditoria` | Cap. 3, Anexo E |
| 7 | 401/404 de auditoría (sin token / no dueño) | Anexo E (seguridad) |

## 3. Fragmentos de código a citar

- Wiring del contexto de usuario y meteorológico en
  `recomendador.routes.ts` (`obtenerContextoUsuarioSafe`,
  `obtenerContextoMeteoSafe`) — muestra que **nunca bloquean** la generación.
- `crearJsonPersistente` (spread `...ia`) + preservación de `schedule` /
  `route_metrics` en `normalizarDia` / `completarDiasConBbdd`.
- La ruta de auditoría en `itinerarios.routes.ts`.
- Normalizadores puros en `recomendador-normalizacion.ts`.

## 4. Tablas a incluir

- **Contrato BACK→IA**: campos del payload (ver `CONTRATO_IA.md`).
- **Contrato IA→BACK**: claves que se persisten en `ia_json`
  (ver `TRAZABILIDAD_IA_JSON.md`).
- **Endpoints** (ver `API_ENDPOINTS_RESUMEN.md`).

## 5. Frases técnicas defendibles

> «El backend es una capa de coordinación, validación, trazabilidad y
> persistencia: enriquece la petición con contexto de usuario y meteorológico,
> delega la recomendación en el motor propio y persiste la traza completa de
> decisión (`decision_trace`, `score_breakdown`, `schedule`) de forma auditable
> y retrocompatible.»

## 6. Apartados de la memoria que respalda el backend

- **Anexo E (API)** — endpoints, contrato IA, auditoría.
- **Anexo D (Base de datos)** — modelo `Itinerario`, `ia_json`.
- **Capítulo 3 (Desarrollo)** — coordinación, contexto, persistencia trazable.
- **Anexo H (Pruebas)** — build, typecheck, tests.

Consulta también `CONTRATO_IA.md`, `TRAZABILIDAD_IA_JSON.md`,
`ENDPOINT_AUDITORIA.md` y `SEGURIDAD_AUTH.md`.

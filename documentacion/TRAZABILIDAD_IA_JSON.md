# Trazabilidad y persistencia de `ia_json`

## 1. Objetivo

Garantizar que **toda** la información que produce el motor de IA (metadatos del motor,
traza de decisión, planificación horaria, métricas de ruta y explicabilidad por POI)
quede **persistida de forma íntegra y consultable**, de modo que cualquier itinerario
sea **auditable** a posteriori. El vehículo de esta trazabilidad es la columna
**`ia_json`** del modelo `Itinerario`.

## 2. Columna de almacenamiento (Prisma)

En `prisma/schema.prisma`, el modelo `Itinerario` declara tres columnas JSON/texto
relevantes:

```prisma
model Itinerario {
  // …
  ia_json           Json?    // JSON completo devuelto por la IA + enriquecido
  ia_resumen        String?  @db.Text   // Resumen textual (summary)
  preferencias_json Json?    // Payload completo enviado a la IA (incl. contexto)
  // …
}
```

- **`ia_json`** — respuesta de la IA fusionada con el post-proceso del backend.
- **`ia_resumen`** — `ia.summary ?? ia.resumen` (texto legible para el usuario).
- **`preferencias_json`** — el `payload` íntegro (destino, señales, `user_context`,
  `weather_context`, `request_seed`…). Permite **reproducir** la petición.

## 3. Construcción del JSON persistente

`crearJsonPersistente()` (`recomendador.routes.ts`) **hace *spread* del objeto `ia`**,
de forma que ningún campo emitido por la IA se pierde, y añade el enriquecimiento local:

```ts
function crearJsonPersistente(ia, dayPlans, eventosPorDia, liveEvents) {
  return {
    ...ia,                       // engine_metadata, decision_trace, request_seed,
                                 // quality_metrics, summary, anchors_used, items…
    day_plans: dayPlans,         // días normalizados (con schedule y route_metrics)
    live_events: liveEvents,     // eventos en directo (si procede)
    live_events_by_day: eventosPorDia,
    generated_at: new Date().toISOString(),
  };
}
```

Gracias al `...ia`, se conservan íntegros:

| Campo preservado | Nivel | Fuente |
|------------------|-------|--------|
| `engine_metadata` | Itinerario | IA |
| `decision_trace` | Itinerario | IA |
| `request_seed` | Itinerario | IA / backend |
| `quality_metrics` | Itinerario | IA |
| `summary` / `anchors_used` / `items` | Itinerario | IA |

## 4. Preservación a nivel de día: `schedule` y `route_metrics`

Históricamente, la normalización de días **descartaba** la planificación horaria y las
métricas de ruta. Ambas funciones se **corrigieron** para conservarlas:

### `normalizarDia()`
```ts
return {
  day_number: day.day_number ?? day.dia ?? index + 1,
  theme: day.theme ?? day.titulo ?? `Día ${index + 1}`,
  total_minutes: day.total_minutes ?? day.minutos ?? null,
  pois,
  local_tips: tips,
  schedule: Array.isArray(day.schedule) ? day.schedule : [],  // ← preservado
  route_metrics: day.route_metrics ?? null,                   // ← preservado
};
```

### `completarDiasConBbdd()`
Cuando el backend completa días con POIs de la base local (porque la IA devolvió pocos),
mantiene la planificación original del día:

```ts
// Conserva la planificación horaria y las métricas de ruta emitidas por la IA.
schedule: Array.isArray(original?.schedule) ? original?.schedule : [],
route_metrics: original?.route_metrics ?? null,
```

## 5. Preservación a nivel de POI (passthrough)

Los campos de explicabilidad por POI viajan **por paso directo** (*passthrough*): al
formar parte de los objetos `IaPoi` dentro de `pois[]`, se almacenan tal cual llegan.

| Campo | Descripción |
|-------|-------------|
| `score_breakdown` | Desglose de la puntuación del POI (`Record<string, number>`) |
| `selection_reasons` | Motivos de selección (`string[]`) |
| `confidence` | Confianza (`number \| null`) |

Estos campos **no se recalculan ni se filtran** en el backend: se persisten para que el
endpoint de auditoría y el frontend puedan mostrarlos.

## 6. Casts de tipos dinámicos (Prisma)

Al ser JSON generado dinámicamente en tiempo de ejecución, se castea al tipo de entrada
de Prisma para satisfacer el sistema de tipos sin perder validación en *runtime*:

```ts
ia_json: iaPersistente as unknown as Prisma.InputJsonValue,
preferencias_json: payload as unknown as Prisma.InputJsonValue,
ia_resumen: ia.summary ?? ia.resumen ?? null,
```

## 7. Sincronización tras edición manual (`audit_history`)

Cuando el usuario edita el itinerario (chat o acción manual), el servicio
`itinerario-edicion.service.ts` mantiene coherente el `ia_json`:

- `syncIaJsonFromDb()` reconstruye `day_plans`/`dias` desde el estado real en base de
  datos (elementos por día), **preservando** el resto de metadatos del día previo con
  *spread* (`...oldDay`).
- Cada edición (`remove`, `insert`, `swap`, `move`, `replace`, `regenerate_day`)
  actualiza `Itinerario.actualizado` y re-sincroniza el JSON, de modo que la traza de
  qué contiene el itinerario se mantiene alineada con la persistencia relacional.

## 8. Compatibilidad hacia atrás

- Itinerarios **antiguos** pueden no tener `engine_metadata` ni `decision_trace`. El
  sistema los soporta: el endpoint de auditoría responde `available: false` (ver
  `ENDPOINT_AUDITORIA.md`) sin romper.
- Los *accessors* de coalescencia (EN/ES) permiten leer tanto `day_plans` como `dias`,
  por lo que JSON de versiones previas siguen siendo interpretables.
- `ia_json` es `Json?` (nullable): un itinerario creado manualmente (`POST
  /api/itinerarios`) simplemente no tiene JSON de IA y el resto de funcionalidad opera
  con normalidad.

## 9. Resumen de qué se guarda y dónde

| Dato | Columna | Cómo |
|------|---------|------|
| Respuesta completa de la IA | `ia_json` | `...ia` en `crearJsonPersistente` |
| Días normalizados + horario + ruta | `ia_json.day_plans[]` | `normalizarDia` / `completarDiasConBbdd` |
| Explicabilidad por POI | `ia_json.day_plans[].pois[]` | passthrough |
| Eventos en directo | `ia_json.live_events*` | post-proceso |
| Resumen legible | `ia_resumen` | `ia.summary ?? ia.resumen` |
| Petición reproducible | `preferencias_json` | `payload` completo |

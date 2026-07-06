# Trazabilidad en el backend de SpainWay

Este documento explica cómo el backend construye el payload hacia la IA, cómo
añade contexto real, cómo persiste la trazabilidad y cómo se audita un
itinerario.

## 1. Cómo se construye el payload hacia la IA

`src/modules/recomendador/recomendador.routes.ts` (`POST /api/recomendador/generar`)
recibe la petición del frontend, valida datos obligatorios (`destination`,
`days`, `base_lat`, `base_lon`) y construye un `PayloadRecomendador` que se
envía tal cual al servicio IA vía `callIaItinerary()`
(`src/servicios/ia.service.ts`), apuntando a
`RECOMMENDER_API_URL/recommend/itinerary`.

## 2. Cómo se añade contexto real de usuario

Antes de llamar a la IA:

```ts
const contextoUsuario = await obtenerContextoUsuarioSpainWay(idUsuario);
const contextoTexto = contextoToTexto(contextoUsuario);
```

(`src/modules/recomendador/recomendador-contexto.service.ts`, ya existente,
ahora **sí se invoca** en el flujo de generación). Si hay preferencias
guardadas, favoritos o mensajes recientes, se añade al payload:

```ts
user_context: {
  preferences, favorites, recent_messages, context_text,
  visited_global_ids, negative_preferences,
}
```

Si el usuario no tiene contexto (usuario nuevo, sin favoritos ni
conversaciones), `user_context` es `null` y la IA responde con
`decision_trace.input_summary.has_user_context = false`. Un fallo al
construir el contexto (error de BD, etc.) se captura con `try/catch` y
**nunca bloquea** la generación del itinerario.

## 3. Cómo se añade meteorología

Con las coordenadas base y fechas del viaje se llama a
`obtenerContextoMeteorologicoSpainWay()` (Open-Meteo, gratuito, ya existente
en `src/modules/meteorologia/meteorologia.service.ts`). Si responde:

```ts
weather_context: {
  available: true,
  summary: "...",
  rainy_slots: ["afternoon"],   // si hay días con probabilidad de lluvia alta
  hot_slots: ["midday"],        // si hay días de calor (>=30°C)
  recommended_adjustments: ["prioritize_indoor_afternoon", "avoid_outdoor_midday"],
}
```

Si falla o no hay coordenadas suficientes: `weather_context: { available: false }`.
También envuelto en `try/catch`: la meteorología **nunca bloquea** la
generación.

## 4. Cómo se llama a la IA

`callIaItinerary()` gestiona warm-up del servicio, cooldown tras 429 y
reintento único ante 502/503. La IA responde con el itinerario completo más
`engine_metadata` y `decision_trace` (ver
`SpainWay-IA2/docs/TFG_EXPLAINABLE_ENGINE.md`).

## 5. Cómo se persiste `ia_json`

El backend guarda la respuesta completa de la IA (incluyendo
`engine_metadata`, `decision_trace`, `quality_metrics` y, por día,
`schedule`/`route_metrics`) dentro de `Itinerario.ia_json` (`Json?`), junto a
`day_plans`, eventos live y `generated_at` (`crearJsonPersistente()`). Los
tipos `IaDayPlan`/`DiaNormalizado` se ampliaron para no descartar `schedule`,
`route_metrics` ni `quality_metrics` al normalizar los días
(`normalizarDia`, `completarDiasConBbdd`).

Cuando el usuario edita el itinerario manualmente (`itinerario-edicion.service.ts`,
`syncIaJsonFromDb`), antes de sobrescribir `ia_json` con los días editados se
guarda una instantánea de la trazabilidad previa (`engine_metadata` +
`decision_trace` + `quality_metrics`) bajo `ia_json.audit_history` (máximo 10
entradas), para no perder la evidencia de cómo se generó la versión original
del viaje aunque se edite después.

No se ha creado una tabla Prisma nueva: se prioriza `ia_json` como fuente de
trazabilidad, tal y como indicó el criterio de riesgo/beneficio de esta fase.

## 6. Cómo se consulta la auditoría

`GET /api/itinerarios/:idItinerario/auditoria` (protegido por JWT, solo el
dueño del itinerario puede consultarlo — mismo patrón que `/detalle/:id`):

```json
{
  "ok": true,
  "data": {
    "available": true,
    "engine": { "name": "...", "version": "...", "generation_mode": "...", "llm_role": "...", "llm_used_for_generation": false },
    "candidate_pipeline": { ... },
    "selected_summary": { ... },
    "scoring_weights": { ... },
    "quality_metrics": { ... },
    "rejected_examples": [ ... ],
    "audit_history_count": 0,
    "summary_message": "Resumen de los criterios técnicos utilizados para construir esta recomendación."
  }
}
```

Si el itinerario se generó antes de esta versión (sin `engine_metadata` ni
`decision_trace` en `ia_json`), responde de forma compatible:

```json
{ "ok": true, "data": { "available": false, "summary_message": "Este itinerario todavía no tiene auditoría técnica disponible." } }
```

No se expone información sensible del usuario (solo agregados del motor).

**Nota importante**: `summary_message` es siempre un texto fijo definido en el
propio endpoint (`itinerarios.routes.ts`), nunca un valor leído de
`decision_trace`. Esto es deliberado: antes de esta corrección, el motor IA
persistía un `decision_trace.defense_message` con lenguaje de defensa
académica ("El LLM no genera el itinerario..."). Ese campo ya no se genera
para itinerarios nuevos, pero itinerarios antiguos aún pueden tener ese texto
guardado en su `ia_json` histórico. Al no leer nunca ese campo para construir
`summary_message`, la API nunca puede filtrar ese texto antiguo a un cliente,
sin necesidad de migrar datos históricos.

## 7. Garantía de POIs reales

Todo POI que llega al backend desde la IA lleva `global_id`/`id_global`
verificable contra la tabla `Poi` (`id_global` único). Las acciones manuales
(`itinerario-edicion.service.ts`) y la búsqueda de complementarios
(`buscarPoisComplementariosDesdeBbdd`) siempre consultan `prisma.poi`
directamente: nunca se inserta un POI que no exista en la base de datos.

## 8. `npm test`

`npm test` ejecutaba antes `echo "Error: no test specified" && exit 1`. Ahora
ejecuta `tsc --noEmit` (alias `npm run typecheck`), validando tipos de todo el
backend en cada ejecución en vez de fallar por defecto.

## 9. Separación entre trazabilidad técnica y comunicación al usuario

El backend no reenvía texto libre de `ia_json`/`decision_trace` como mensaje
para el usuario. Cualquier campo tipo `summary_message` que exponga una API
del backend (por ejemplo, el endpoint de auditoría) es un texto fijo definido
en el propio código de la ruta, no un valor leído de la respuesta de la IA.
La trazabilidad técnica completa (`engine_metadata`, `decision_trace`,
`candidate_pipeline`, `scoring_weights`, campos como `llm_role` o
`llm_used_for_generation`) sigue disponible para auditoría y memoria, pero
nunca se traduce automáticamente en prosa de cara al usuario final.

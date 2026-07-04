# Contrato de comunicación Backend ↔ IA

Este documento describe el contrato exacto entre el backend y el **microservicio de IA**
(Python). El backend actúa de cliente. La integración principal es la generación de
itinerarios; existen además dos llamadas auxiliares (parser de chat y recomendación de
POIs libres).

Cliente: `src/servicios/ia.service.ts` (itinerarios) y `chat-acciones.routes.ts`
(parser y POIs libres). Base URL: `RECOMMENDER_API_URL`.

---

## 1. Endpoints de la IA que consume el backend

| Método | Ruta IA | Origen (backend) | Propósito |
|--------|---------|------------------|-----------|
| `GET` | `/health` | `ia.service.ts` → `ensureIaReady()` | Warm-up (fallback `GET /`) |
| `POST` | `/recommend/itinerary` | `ia.service.ts` → `callIaItinerary()` | Generar itinerario completo |
| `POST` | `/chat/parse-action` | `chat-acciones.routes.ts` → `llamarParserIA()` | Interpretar lenguaje natural → acción |
| `POST` | `/recommend/pois` | `chat-acciones.routes.ts` → `recomendarPoisLibres()` | Recomendar POIs sueltos (con fallback local) |

---

## 2. Payload BACK → IA (`POST /recommend/itinerary`)

Construido en `recomendador.routes.ts` (objeto `payload: PayloadRecomendador`, líneas
~1159–1201). **Todas** estas señales se envían a la IA. Las marcadas como *(NUEVO)* se
reenvían tras la mejora; antes se perdían al reconstruir el payload en el backend.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id_usuario` | `number` | Identificador del usuario |
| `destination` | `string` | Destino (obligatorio) |
| `days` | `number` | Nº de días (1–14) |
| `budget` | `string` | `bajo` / `medio` / `alto` (por defecto `medio`) |
| `dates` | `string[]` | `[inicio, fin]` en ISO |
| `pace` | `string` | **Normalizado:** `relajado` / `equilibrado` / `intenso` |
| `trip_type` | `string` | Tipo de viaje (por defecto `mixto`) |
| `companions` | `string` | Con quién se viaja |
| `transport` | `string` | **Normalizado:** `coche` / `a pie` / `transporte publico` / `mixto` |
| `must_see` | `string` | Imprescindibles del usuario |
| `extras` | `string` | Extras / observaciones |
| `notes` | `string` | Notas libres |
| `base_location_name` / `base_address` / `base_place_id` | `string` | Alojamiento base |
| `base_lat` / `base_lon` | `number` | Coordenadas base (obligatorias, con rango validado) |
| `allow_excursions` | `boolean` | Permite excursiones fuera del núcleo |
| `max_distance_km` | `number\|null` | Radio máximo |
| `visited_global_ids` | `string[]` | POIs ya visitados (por `id_global`) |
| `visited_poi_names` | `string[]` | POIs ya visitados (por nombre) *(NUEVO reenvío)* |
| `negative_preferences` | `string[]` | Preferencias negativas ("sin museos"…) *(NUEVO)* |
| `include_live_events` | `boolean` | Insertar eventos en directo |
| `wants_beach` / `wants_nature` / `wants_culture` / `wants_food` / `wants_events` | `boolean` | Señales de interés *(NUEVO)* |
| `interest_tags` | `string[]` | Etiquetas de interés *(NUEVO)* |
| `travel_style_tags` | `string[]` | Etiquetas de estilo de viaje *(NUEVO)* |
| `climate_preference` | `string` | Preferencia climática *(NUEVO)* |
| `request_seed` | `string` | Semilla de reproducibilidad determinista *(NUEVO)* |
| `context_text` | `string` | Contexto de usuario aplanado a texto *(NUEVO)* |
| `user_context` | `object` | Contexto de usuario estructurado *(NUEVO)* |
| `weather_context` | `object` | Previsión Open-Meteo *(NUEVO)* |

### 2.1. `user_context` (aplanado para la IA)

`construirUserContextParaIa()` toma el contexto crudo y lo **aplana a las claves que el
motor sabe leer** (ver `CONTEXTO_USUARIO.md`):

```jsonc
{
  "preferencias": { "presupuesto": 2, "estilo_viaje": "cultural", "intereses": "arte, gastronomía", "...": "..." },
  "favoritos": [ { "id_poi": 12, "nombre": "Museo del Prado", "categoria": "Museo", "municipio": "Madrid" } ],
  "mensajes_recientes": [ { "rol": "user", "contenido": "…", "creado": "2026-07-01T…" } ],
  "intereses": "arte, gastronomía",
  "estilo_viaje": "cultural",
  "categorias_preferidas": ["Museo", "Parque"],
  "municipios_favoritos": ["Madrid"],
  "context_text": "Intereses guardados: arte, gastronomía. Estilo de viaje: cultural. …"
}
```

### 2.2. Ejemplo de payload (reducido)

```jsonc
{
  "id_usuario": 42,
  "destination": "Valencia",
  "days": 3,
  "budget": "medio",
  "dates": ["2026-08-10", "2026-08-12"],
  "pace": "equilibrado",
  "transport": "transporte publico",
  "base_lat": 39.4699, "base_lon": -0.3763,
  "wants_beach": true, "wants_culture": true,
  "interest_tags": ["playa", "gastronomía"],
  "negative_preferences": ["sin museos abarrotados"],
  "request_seed": "valencia|3|equilibrado|transporte publico",
  "context_text": "Intereses guardados: playa, gastronomía. …",
  "user_context": { "...": "..." },
  "weather_context": { "provider": "open-meteo", "...": "..." }
}
```

---

## 3. Respuesta IA → BACK (`IaResponse`)

Tipada en `recomendador.routes.ts`. La IA emite claves **canónicas en inglés**; el
backend acepta también variantes en español (ver §4).

```jsonc
{
  "destination": "Valencia",
  "days": 3,
  "summary": "Itinerario equilibrado centrado en casco histórico y playa…",
  "anchors_used": ["Ciudad de las Artes", "Playa de la Malvarrosa"],
  "request_seed": "valencia|3|equilibrado|transporte publico",
  "engine_metadata": {
    "engine_version": "…", "model": "…", "generation_ms": 1234
  },
  "decision_trace": {
    "input_summary": { "destination": "Valencia", "days": 3, "…": "…" },
    "candidate_pipeline": [ { "stage": "retrieval", "in": 500, "out": 120 }, { "stage": "scoring", "…": "…" } ],
    "scoring_weights": { "distance": 0.3, "popularity": 0.2, "interest_match": 0.5 },
    "selected_summary": { "total_pois": 9, "…": "…" },
    "quality_flags": ["ok"]
  },
  "quality_metrics": { "coverage": 0.92, "diversity": 0.7 },
  "day_plans": [
    {
      "day_number": 1,
      "theme": "Casco histórico",
      "total_minutes": 300,
      "pois": [
        {
          "global_id": "poi_valencia_catedral",
          "name": "Catedral de Valencia",
          "reason": "Hito imprescindible cercano a tu base.",
          "score_breakdown": { "distance": 0.8, "popularity": 0.9, "interest_match": 0.7 },
          "selection_reasons": ["cercanía", "alta popularidad"],
          "confidence": 0.86
        }
      ],
      "local_tips": ["Reserva entrada online para evitar colas."],
      "schedule": [
        { "slot_type": "visit", "start_time": "10:00", "end_time": "11:30",
          "poi_global_id": "poi_valencia_catedral", "poi_name": "Catedral de Valencia",
          "estimated_visit_minutes": 90, "travel_from_previous_minutes": 0,
          "estimated_distance_km": 0.0, "reason": "Primera parada de la mañana" }
      ],
      "route_metrics": { "total_distance_km": 4.2, "total_walking_minutes": 55 }
    }
  ]
}
```

### 3.1. Bloques de explicabilidad

| Bloque | Nivel | Uso en el backend |
|--------|-------|-------------------|
| `engine_metadata` | Itinerario | Metadatos del motor; base del endpoint de auditoría |
| `decision_trace` | Itinerario | Traza de decisión (pipeline, pesos, resumen) |
| `quality_metrics` | Itinerario | Métricas de calidad de la recomendación |
| `score_breakdown` | POI | Desglose de puntuación por POI (passthrough) |
| `selection_reasons` | POI | Motivos de selección por POI (passthrough) |
| `confidence` | POI | Confianza por POI (passthrough) |
| `schedule` | Día | Planificación horaria por franjas |
| `route_metrics` | Día | Métricas de ruta del día |

---

## 4. Tolerancia de nombres de campo (coalescencia EN/ES)

El backend **coalesce** claves inglesas y españolas mediante *accessors*, por lo que es
robusto ante ambas variantes. La IA emite el canónico en inglés.

| Concepto | Claves aceptadas | Accessor (`recomendador.routes.ts`) |
|----------|------------------|-------------------------------------|
| ID global de POI | `global_id` \| `id_global` | `getPoiGlobalId()` |
| Nombre de POI | `name` \| `nombre` | `getPoiName()` |
| Motivo de POI | `reason` \| `motivo` | `getPoiReason()` |
| Lista de días | `day_plans` \| `dias` | `getDayPlans()` |
| Nº de día | `day_number` \| `dia` | `normalizarDia()` |
| Tema del día | `theme` \| `titulo` | `normalizarDia()` |
| Minutos del día | `total_minutes` \| `minutos` | `normalizarDia()` |
| POIs del día | `pois` \| `items` | `normalizarDia()` |
| Consejos del día | `local_tips` \| `consejos` | `normalizarDia()` |
| Resumen | `summary` \| `resumen` | `mensajeAsistente()` |
| Imagen | `image_url` \| `imagen_url` | tipo `IaPoi` |

---

## 5. Llamadas auxiliares

### `POST /chat/parse-action`
`chat-acciones.routes.ts` → `llamarParserIA()`. Envía `{ message, current_destination,
current_days, itinerary_id, pois_by_day, recent_messages, force_external_llm: true }`
con *timeout* de 9 s. Si la IA no responde o falla, se aplica un parser interno por
reglas (`sanitizeParsedAction`) y no rompe la conversación.

### `POST /recommend/pois`
`chat-acciones.routes.ts` → `recomendarPoisLibres()`. Envía `{ destination, days,
pace, transport, interests, must_include, excluded_poi_global_ids, excluded_poi_names,
negative_preferences }` con *timeout* de 30 s. **Fallback local**: si la IA cae, se
buscan POIs reales en PostgreSQL (`recomendarPoisLocalFallback`).

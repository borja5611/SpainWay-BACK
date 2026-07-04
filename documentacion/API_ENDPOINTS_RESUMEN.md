# Resumen de endpoints de la API

Backend Fastify. Prefijos registrados en `src/app.ts`. Lista no exhaustiva de las
rutas más relevantes para el TFG.

## Recomendador / itinerarios

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/recomendador/generar` | id_usuario en body | Genera itinerario: enriquece contexto, llama a la IA y persiste `ia_json`. |
| GET | `/api/itinerarios/:id_usuario` | JWT | Lista de itinerarios del usuario. |
| GET | `/api/itinerarios/resumen/:id_usuario` | JWT | Resumen (incluye `ia_json`). |
| GET | `/api/itinerarios/detalle/:id_itinerario` | — | Detalle completo (días, elementos, POIs). |
| GET | `/api/itinerarios/mapa/:id_usuario` | JWT | POIs de itinerarios para el mapa. |
| **GET** | **`/api/itinerarios/:idItinerario/auditoria`** | **JWT + dueño** | **Traza de decisión del recomendador (nuevo).** |
| POST | `/api/itinerarios` | JWT | Crear itinerario. |
| PATCH | `/api/itinerarios/:id_itinerario` | JWT | Editar itinerario. |
| POST | `/api/itinerarios/:id/acciones/manual` | JWT | Acción manual (añadir/quitar/mover POI). |
| POST | `/api/itinerarios/:id/regenerar-dia` | JWT | Regenerar un día. |
| DELETE | `/api/itinerarios/:idItinerario` | JWT | Eliminar itinerario. |

## Chat / acciones

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/chat-acciones/:id_conversacion/procesar` | Interpreta una acción de chat (usa el parser NL de la IA). |

## Datos / catálogo

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/pois/...` | POIs, categorías, destacados. |
| GET | `/api/municipios`, `/api/provincias`, `/api/comunidades` | Divisiones territoriales. |
| GET | `/api/favoritos` (+ POST/DELETE) | Favoritos del usuario (JWT). |
| GET | `/api/meteorologia/...` | Previsión (Open-Meteo). |
| GET | `/api/eventos-live/search` | Eventos en vivo (Ticketmaster/PredictHQ). |
| GET | `/api/restauracion/...` | Restauración local. |

## Auth

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/registro`, `/api/auth/login` | Alta y acceso (JWT). |
| POST | `/api/auth/password-reset/...` | Recuperación de contraseña. |

## Salud

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Estado del backend. |

## Servicios externos que orquesta el backend

- Microservicio IA: `POST {RECOMMENDER_API_URL}/recommend/itinerary`,
  `/recommend/pois`, `/chat/parse-action` (ver `CONTRATO_IA.md`).
- Open-Meteo (meteorología). Ticketmaster / PredictHQ (eventos).

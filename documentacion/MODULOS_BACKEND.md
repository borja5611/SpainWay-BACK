# Módulos del Backend

Todos los módulos residen en `src/modules/<modulo>/` y se registran en `src/app.ts`
con prefijo `/api/<modulo>`. La convención de nombres es `<modulo>.routes.ts` para los
handlers HTTP y, opcionalmente, `.service.ts` / `.controller.ts` / `.schema.ts`.

## 1. Módulos registrados (montados en `app.ts`)

| Módulo | Prefijo | Ficheros clave | Responsabilidad |
|--------|---------|----------------|-----------------|
| **health** | `/api/health` | `health.routes.ts` | Estado del backend y *warm-up* de la IA (`/wake-ia`) |
| **auth** | `/api/auth` | `auth.routes.ts` | Registro, login, JWT, `/me`, refresh, reset de contraseña, Google OAuth |
| **recomendador** | `/api/recomendador` | `recomendador.routes.ts`, `recomendador-normalizacion.ts`, `recomendador-contexto.service.ts` | **Núcleo:** genera itinerarios llamando a la IA, enriquece y persiste |
| **itinerarios** | `/api/itinerarios` | `itinerarios.routes.ts`, `itinerario-edicion.service.ts` | CRUD, mapa, edición manual, regeneración de día y **auditoría** |
| **chat-acciones** | `/api/chat-acciones` | `chat-acciones.routes.ts` | Edición conversacional: NL → acción (parser IA + reglas) |
| **pois** | `/api/pois` | `pois.routes.ts`, `pois.service.ts` | Catálogo de POIs: búsqueda, cercanos, destacados, filtros |
| **pois-destacados** | `/api/pois-destacados` | `pois-destacados.routes.ts` | POIs "must-see" por comunidad/provincia/municipio |
| **favoritos** | `/api/favoritos` | `favoritos.routes.ts` | Favoritos por usuario (con propiedad verificada) |
| **preferencias** | `/api/preferencias` | `preferencias.routes.ts` | Preferencias de viaje (`Pref_usuario`) |
| **meteorologia** | `/api/meteorologia` | `meteorologia.routes.ts`, `meteorologia.service.ts` | Previsión Open-Meteo (endpoint FRONT + servicio para la IA) |
| **eventos-live** | `/api/eventos-live` | `eventos-live.routes.ts` | Eventos en directo agregados (Ticketmaster, PredictHQ, SerpApi) |
| **eventos** | `/api/eventos` | `eventos.routes.ts` | Eventos persistidos por municipio |
| **restauracion** | `/api/restauracion` | `restuaracion.routes.ts`, `restauracion.service.ts` | Restaurantes cercanos y selección por itinerario |
| **conversaciones** | `/api/conversaciones` | `conversaciones.routes.ts` | Conversaciones asociadas a itinerarios |
| **mensajes** | `/api/mensajes` | `mensajes.routes.ts` | Mensajes de una conversación |
| **usuarios** | `/api/usuarios` | `usuarios.routes.ts` | Consulta/edición/borrado de usuario |
| **interacciones** | `/api/interacciones` | `interacciones.routes.ts` | Interacciones usuario–POI (analítica de uso) |
| **analitica** | `/api/analitica` | `analitica.routes.ts` | Registro de eventos de analítica |
| **comunidades** | `/api/comunidades` | `comunidades.*` | Catálogo geográfico: CCAA |
| **provincias** | `/api/provincias` | `provincias.*` | Catálogo geográfico: provincias |
| **municipios** | `/api/municipios` | `municipios.*` | Catálogo geográfico: municipios |
| **categorias-poi** | `/api/categorias-poi` | `categorias-poi.*` | Catálogo de categorías de POI |
| **programacion-poi** | `/api/programacion-poi` | `programacion-poi.routes.ts` | Horarios de apertura de POIs |
| **lugares-locales** | `/api/lugares-locales` | `lugares-locales.routes.ts` | Búsqueda de lugares locales (Foursquare/Geoapify) |

## 2. Servicios transversales (`src/servicios/`)

| Servicio | Fichero | Responsabilidad |
|----------|---------|-----------------|
| **Cliente IA** | `ia.service.ts` | `callIaItinerary`, `ensureIaReady`: warm-up, *cooldown*, retry, *lock* |
| **Email** | `emailServicio.ts` | Envío de códigos de recuperación de contraseña (nodemailer/SMTP) |

## 3. Utilidades y librería

| Fichero | Función |
|---------|---------|
| `src/lib/prisma.ts` | Singleton `PrismaClient` (evita múltiples conexiones en dev) |
| `src/lib/logger.ts` | Logger |
| `src/config/env.ts` | Carga tipada y validada de variables de entorno |
| `src/config/cors.ts` | Configuración CORS auxiliar |
| `src/utils/googleSearchUrl.ts` | Generación de URLs de búsqueda de Google para POIs |

## 4. Anatomía del módulo `recomendador` (núcleo)

Es el módulo más relevante para el TFG. Se compone de tres piezas:

- **`recomendador.routes.ts`** — orquestador del endpoint `POST /generar`: validación,
  enriquecimiento de contexto, llamada a la IA, post-proceso, persistencia transaccional.
- **`recomendador-normalizacion.ts`** — **módulo puro** (sin Prisma ni red) con
  `normalizarRitmo`, `normalizarTransporte`, `construirRequestSeed`, `sanitizarLista`.
  Es el objetivo de las pruebas unitarias.
- **`recomendador-contexto.service.ts`** — `obtenerContextoUsuarioSpainWay` y
  `contextoToTexto`: recopilan preferencias, favoritos y mensajes recientes del usuario.

## 5. Módulos presentes pero NO montados

Los siguientes ficheros existen en `src/modules/` pero **no** están registrados en
`app.ts` en el estado actual (útil documentarlo para evitar confusión):

- `ubicaciones/ubicaciones.routes.ts` (`GET /sugerencias`)
- `eventos-turisticos/eventos-turisticos.routes.ts`
- `auth/passwordReset.routes.ts` (la funcionalidad de reset vive en `auth.routes.ts`)

> Estos módulos no exponen endpoints activos; se documentan por completitud del código.

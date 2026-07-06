# Arquitectura del Backend

## 1. Visión general

El backend de SpainWay es un **servicio HTTP Fastify 5 + TypeScript** que expone una
API REST bajo `/api/*` y que orquesta la comunicación con un **microservicio de IA en
Python**. Su responsabilidad es **coordinar, validar, enriquecer, trazar y persistir**;
la generación de recomendaciones (selección y *scoring* de POIs) ocurre en la IA.

```
┌────────────┐        HTTPS/JSON        ┌────────────────────┐        HTTP/JSON        ┌──────────────────┐
│  FRONTEND  │ ───────────────────────▶ │   BACKEND (este)   │ ──────────────────────▶ │  IA (Python)     │
│  React     │ ◀─────────────────────── │  Fastify + Prisma  │ ◀────────────────────── │  /recommend/*    │
│  (Vercel)  │        JWT Bearer        │  (Render)          │   payload enriquecido   │  /chat/parse-*   │
└────────────┘                          └─────────┬──────────┘                          └──────────────────┘
                                                  │ Prisma
                                                  ▼
                                        ┌────────────────────┐
                                        │  PostgreSQL (Neon) │
                                        └────────────────────┘
```

Servicios externos adicionales que consume el backend: **Open-Meteo** (meteorología),
**Ticketmaster / PredictHQ / SerpApi** (eventos en directo), **Foursquare / Geoapify**
(restauración) y **Google OAuth / SMTP** (autenticación y correo).

---

## 2. Estructura de carpetas

```
src/
├── server.ts                 # Entry point: listen()
├── app.ts                    # buildApp(): registra plugins y 24 módulos de rutas
├── config/
│   ├── env.ts                # Carga y saneamiento de variables de entorno
│   └── cors.ts               # Configuración CORS
├── lib/
│   ├── prisma.ts             # Singleton de PrismaClient
│   └── logger.ts             # Logger
├── generated/prisma/         # Cliente Prisma generado
├── servicios/                # Servicios transversales
│   ├── ia.service.ts         # Cliente del microservicio IA (warm-up, retry, lock)
│   └── emailServicio.ts      # Envío de correos (nodemailer)
└── modules/<modulo>/
    ├── <modulo>.routes.ts    # Handlers HTTP (obligatorio)
    ├── <modulo>.service.ts   # Lógica de negocio (opcional)
    ├── <modulo>.controller.ts
    └── <modulo>.schema.ts
```

Convención: **un módulo = un dominio funcional**. Las rutas se registran con prefijo
en `app.ts` mediante `app.register(modRoutes, { prefix: "/api/<modulo>" })`.

---

## 3. Capas lógicas

| Capa | Ubicación | Función |
|------|-----------|---------|
| **Bootstrap** | `server.ts`, `app.ts` | Arranque, registro de plugins y rutas |
| **Configuración** | `config/env.ts` | Variables tipadas y validadas |
| **Transporte (rutas)** | `modules/*/*.routes.ts` | Validación de entrada, auth, códigos HTTP |
| **Servicios de dominio** | `modules/*/*.service.ts`, `servicios/` | Lógica, integraciones externas |
| **Normalización pura** | `recomendador/recomendador-normalizacion.ts` | Funciones puras testables (sin I/O) |
| **Persistencia** | `lib/prisma.ts` + Prisma | Acceso a PostgreSQL |

La separación de **funciones puras** (`recomendador-normalizacion.ts`) permite testear
la lógica de normalización/saneamiento sin base de datos ni red (ver `TESTS_BACKEND.md`).

---

## 4. Registro de plugins (`buildApp`)

`src/app.ts` construye la instancia Fastify y registra, en orden:

1. **`@fastify/cors`** — orígenes permitidos: `FRONTEND_URL`, `localhost:5173`,
   `127.0.0.1:5173`, `https://spain-way-front.vercel.app`; `credentials: true`;
   métodos `GET/POST/PUT/PATCH/DELETE/OPTIONS`; headers `Content-Type`, `Authorization`.
2. **`@fastify/jwt`** — secreto `JWT_SECRET` (obligatorio en producción; en dev usa un
   valor local). Habilita `request.jwtVerify()` y `app.jwt.sign()`.
3. **`@fastify/swagger` + `swagger-ui`** — documentación OpenAPI en **`/docs`**.
4. **24 módulos de rutas** con prefijo `/api/*`.

Validaciones de arranque: si `NODE_ENV=production` y falta `JWT_SECRET` o
`PASSWORD_RESET_SECRET`, `buildApp()` lanza y el proceso no arranca (fail-fast).

---

## 5. Ciclo de vida de una petición

Ejemplo: **`POST /api/recomendador/generar`** (flujo central del sistema).

1. **Validación de entrada** (`recomendador.routes.ts`): `id_usuario`, `destination`
   (obligatorio), `days` (1–14), `base_lat`/`base_lon` (obligatorios y con rango
   geográfico válido). Respuestas `400` con mensaje concreto si falla.
2. **Normalización** (`recomendador-normalizacion.ts`): `pace`→`{relajado|equilibrado|
   intenso}`, `transport`→`{coche|a pie|transporte publico|mixto}`, listas saneadas,
   `request_seed` determinista.
3. **Enriquecimiento de contexto** (nunca bloqueante): en paralelo se obtienen el
   **contexto de usuario** (`obtenerContextoUsuarioSafe`) y el **contexto meteorológico**
   (`obtenerContextoMeteoSafe`). Ambos envueltos en `try/catch` → si fallan, devuelven
   `null` y la generación continúa.
4. **Construcción del payload** hacia la IA con TODAS las señales (ver `CONTRATO_IA.md`).
5. **Llamada a la IA** (`callIaItinerary`): warm-up compartido, *lock* anti-doble
   generación, *timeout* de 50 s, reintento único ante 502/503, *cooldown* ante 429.
6. **Post-proceso**: filtrado de POIs excluidos/visitados, completado de días con la
   BBDD local si la IA devuelve pocos POIs, e inserción opcional de eventos en directo.
7. **Persistencia transaccional** (`prisma.$transaction`): `Itinerario` + `Dia_Itinerario`
   + `Elemento_Itinerario` + `Conversacion` + `Mensaje`, y el JSON íntegro en `ia_json`.
8. **Respuesta `201`** con `id_itinerario`, `id_conversacion`, itinerario completo y el
   JSON de IA persistido.

---

## 6. Rol de coordinación con la IA

El backend **coordina y protege** la comunicación con la IA a través de
`src/servicios/ia.service.ts`, que centraliza tres puntos:

- **Warm-up** (`ensureIaReady`): la IA vive en Render y puede estar "fría". Antes de
  generar, hace `GET /health` (con TTL de 5 min); marca la IA como caliente para evitar
  arranques en frío repetidos.
- **Resiliencia**: *cooldown* ante `429` (respeta `Retry-After`), reintento único ante
  `502/503`, *timeout* de 50 s y mensajes de usuario claros según el estado.
- **Concurrencia**: bandera `generationInProgress` que impide dos generaciones
  simultáneas (evita duplicar itinerarios y sobrecargar la IA).

Además, el backend hace **tolerante** la integración: si la IA no responde a tiempo en
recomendaciones libres del chat, se aplica un **fallback local** que busca POIs reales
en PostgreSQL, garantizando que el usuario nunca se queda sin respuesta.

---

## 7. Principios de diseño aplicados

- **Fail-safe sobre fail-fast en el enriquecimiento**: el contexto extra nunca tumba la
  funcionalidad principal.
- **Backward compatibility**: los itinerarios antiguos siguen funcionando aunque no
  tengan traza de auditoría.
- **Trazabilidad total**: se persiste el JSON completo de la IA (`ia_json`) incluyendo
  metadatos del motor y la traza de decisión.
- **Validación endurecida a mano**: no se añadió Zod (no es dependencia del proyecto);
  la validación es explícita y auditada.

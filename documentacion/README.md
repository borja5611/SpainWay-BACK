# SpainWay — Backend (documentación técnica)

Documentación técnica del **backend de SpainWay**, redactada para su reutilización
en la memoria del Trabajo de Fin de Grado (TFG) de Ingeniería Informática.

SpainWay es una plataforma de planificación turística inteligente para España. El
backend actúa como **capa de coordinación, trazabilidad, validación y persistencia**
entre el frontend (React/Vercel) y un **microservicio de IA en Python** (motor de
recomendación desplegado aparte). El backend **no genera** recomendaciones: valida y
enriquece la petición, invoca a la IA, y **persiste el resultado completo y trazable**.

---

## 1. Stack tecnológico

| Capa | Tecnología | Versión (package.json) |
|------|-----------|------------------------|
| Runtime | Node.js | — |
| Framework HTTP | Fastify | `^5.8.4` |
| Lenguaje | TypeScript | `^6.0.2` |
| ORM | Prisma | `^6.19.3` |
| Base de datos | PostgreSQL (Neon, serverless) | — |
| Autenticación | `@fastify/jwt` | `^10.0.0` |
| CORS | `@fastify/cors` | `^11.2.0` |
| Documentación API | `@fastify/swagger` + `swagger-ui` | `^9.7.0` / `^5.2.5` |
| Hashing | `bcryptjs` | `^3.0.3` |
| Email | `nodemailer` | `^8.0.7` |
| Driver PG | `pg` / `@prisma/adapter-pg` | `^8.20.0` / `^7.7.0` |
| Dev runner | `tsx` | `^4.21.0` |
| Despliegue | Render (web service) | — |

El cliente Prisma se genera con el generador `prisma-client-js` y se consume en el
código a través del paquete `@prisma/client` (`src/lib/prisma.ts`). Los artefactos
generados del cliente residen bajo `src/generated/prisma`.

---

## 2. Arranque del proyecto

Punto de entrada: **`src/server.ts`** → llama a **`buildApp()`** en **`src/app.ts`**.

```ts
// src/server.ts
const app = await buildApp();
await app.listen({ port: env.PORT, host: "0.0.0.0" });
```

`buildApp()` registra CORS, JWT, Swagger y **24 módulos de rutas** con prefijo
`/api/*` (ver `src/app.ts`). El servidor escucha en `0.0.0.0` para ser accesible en
el contenedor de Render.

---

## 3. Comandos (scripts npm)

| Script | Comando | Uso |
|--------|---------|-----|
| `dev` | `tsx watch src/server.ts` | Desarrollo con recarga en caliente |
| `build` | `tsc` | Compilación a `dist/` |
| `start` | `node dist/server.js` | Ejecución en producción |
| `typecheck` | `tsc --noEmit` | Verificación de tipos sin emitir (NUEVO) |
| `test` | `tsx --test tests/**/*.test.ts` | Tests con el runner nativo de Node (NUEVO) |
| `prisma:generate` | `prisma generate` | Regenera el cliente Prisma |
| `prisma:migrate` | `prisma migrate dev` | Migraciones en desarrollo |
| `prisma:studio` | `prisma studio` | Explorador visual de la BBDD |

Instalación y arranque local:

```bash
npm install
npm run prisma:generate
npm run dev        # http://localhost:3000  ·  Swagger en /docs
```

Verificación antes de entregar:

```bash
npx prisma validate    # OK
npx prisma generate    # OK
npm run build          # exit 0
npm test               # 4 tests OK (node:test)
```

---

## 4. Variables de entorno

Definidas y saneadas en **`src/config/env.ts`**. Las marcadas como *obligatorias en
producción* lanzan error al arrancar si faltan cuando `NODE_ENV=production`.

| Variable | Por defecto | Notas |
|----------|-------------|-------|
| `PORT` | `3000` | Puerto HTTP |
| `NODE_ENV` | `development` | `production` activa validaciones estrictas |
| `DATABASE_URL` | — | **Obligatoria en prod.** Cadena Postgres/Neon |
| `DIRECT_URL` | `""` | Conexión directa (migraciones Neon) |
| `FRONTEND_URL` | `http://localhost:5173` | Origen CORS |
| `JWT_SECRET` | — | **Obligatoria en prod.** Firma de tokens |
| `PASSWORD_RESET_SECRET` | — | **Obligatoria en prod.** Hash de códigos de reset |
| `PASSWORD_RESET_MINUTES` | `10` | TTL del código de recuperación |
| `RECOMMENDER_API_URL` | `http://localhost:8001` | URL del microservicio IA (ver nota) |
| `FSQ_API_KEY` / `GEOAPIFY_API_KEY` | `""` | Proveedores de lugares |
| `TICKETMASTER_API_KEY` / `PREDICTHQ_API_KEY` | `""` | Eventos en directo |
| `SERPAPI_API_KEY` | `""` | Google Events vía SerpApi |
| `EVENTS_LIVE_ENABLED` | `true` | Interruptor de eventos live |
| `LOCAL_SEARCH_ENABLED` | `true` | Búsqueda local de lugares |
| `SMTP_HOST/PORT/USER/PASS/FROM` | `""` | Envío de correos (recuperación) |
| `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | `""` | OAuth con Google |

> **Nota sobre `RECOMMENDER_API_URL`:** el cliente IA (`src/servicios/ia.service.ts`)
> usa `process.env.RECOMMENDER_API_URL` y, si no está definida, aplica su **propio
> valor por defecto** `https://spainway-ia.onrender.com`. El módulo `chat-acciones`
> usa `env.RECOMMENDER_API_URL` (por defecto `http://localhost:8001`). En producción
> **siempre** debe fijarse esta variable para evitar ambigüedad.

---

## 5. Mapa de módulos

Cada módulo vive en `src/modules/<modulo>/` con el patrón `*.routes.ts` (y
opcionalmente `*.service.ts`, `*.controller.ts`, `*.schema.ts`). Servicios
transversales en `src/servicios/`.

| Prefijo | Módulo | Responsabilidad |
|---------|--------|-----------------|
| `/api/health` | health | Estado del backend y *warm-up* de la IA |
| `/api/auth` | auth | Registro, login, JWT, reset de contraseña, Google OAuth |
| `/api/recomendador` | recomendador | Generación de itinerarios vía IA (núcleo) |
| `/api/itinerarios` | itinerarios | CRUD, edición y **auditoría** de itinerarios |
| `/api/chat-acciones` | chat-acciones | Edición conversacional (NL → acción) |
| `/api/pois` | pois | Catálogo de puntos de interés |
| `/api/favoritos` | favoritos | Favoritos por usuario |
| `/api/preferencias` | preferencias | Preferencias de viaje del usuario |
| `/api/meteorologia` | meteorologia | Previsión Open-Meteo para el itinerario |
| `/api/eventos-live` | eventos-live | Eventos en directo (Ticketmaster/PredictHQ/SerpApi) |
| `/api/restauracion` | restauracion | Restaurantes cercanos (Foursquare/Geoapify) |
| resto | comunidades, provincias, municipios, categorias-poi, pois-destacados, usuarios, conversaciones, mensajes, interacciones, analitica, eventos, programacion-poi, lugares-locales | Catálogo geográfico, mensajería y analítica |

Detalle completo en [`MODULOS_BACKEND.md`](./MODULOS_BACKEND.md) y
[`API_ENDPOINTS_RESUMEN.md`](./API_ENDPOINTS_RESUMEN.md).

---

## 6. Índice de esta documentación

| Documento | Contenido |
|-----------|-----------|
| [ARQUITECTURA_BACKEND.md](./ARQUITECTURA_BACKEND.md) | Arquitectura Fastify, capas, ciclo de vida, rol coordinador |
| [MODULOS_BACKEND.md](./MODULOS_BACKEND.md) | Tabla de módulos y responsabilidades |
| [CONTRATO_IA.md](./CONTRATO_IA.md) | Contrato de payload/respuesta BACK↔IA |
| [TRAZABILIDAD_IA_JSON.md](./TRAZABILIDAD_IA_JSON.md) | Qué guarda `ia_json` y cómo preserva la traza |
| [ENDPOINT_AUDITORIA.md](./ENDPOINT_AUDITORIA.md) | Endpoint de auditoría de decisiones |
| [CONTEXTO_USUARIO.md](./CONTEXTO_USUARIO.md) | Contexto de usuario hacia la IA |
| [CONTEXTO_METEOROLOGICO.md](./CONTEXTO_METEOROLOGICO.md) | Contexto meteorológico hacia la IA |
| [SEGURIDAD_AUTH.md](./SEGURIDAD_AUTH.md) | JWT, propiedad de recursos y consideraciones |
| [API_ENDPOINTS_RESUMEN.md](./API_ENDPOINTS_RESUMEN.md) | Tabla completa de endpoints REST |
| [TESTS_BACKEND.md](./TESTS_BACKEND.md) | Pruebas, typecheck y build |
| [DESPLIEGUE_BACKEND.md](./DESPLIEGUE_BACKEND.md) | Despliegue en Render + Neon |
| [EVIDENCIAS_MEMORIA.md](./EVIDENCIAS_MEMORIA.md) | Evidencias a capturar para el TFG |

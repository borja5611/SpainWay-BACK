# Despliegue del backend

## Plataforma

- **Render** (servicio web Node) para la API.
- **Neon** (PostgreSQL gestionado) como base de datos.
- Cliente Prisma generado en `src/generated/prisma` (comprometido).

## Build y arranque

```bash
npm install
npx prisma generate     # genera el cliente (se ejecuta en el build de Render)
npm run build           # tsc → dist/
npm start               # node dist/server.js
```

`src/server.ts` hace `listen()`; `src/app.ts` construye la instancia Fastify y
registra plugins (JWT, CORS, Swagger) y rutas.

## Variables de entorno (resumen)

| Variable | Uso |
|----------|-----|
| `DATABASE_URL` / `DIRECT_URL` | Conexión a Neon (obligatoria en prod). |
| `JWT_SECRET` | Firma de tokens (obligatoria en prod). |
| `RECOMMENDER_API_URL` | URL del microservicio IA. |
| `FRONTEND_URL` | CORS. |
| `PASSWORD_RESET_SECRET` | Recuperación de contraseña. |
| `TICKETMASTER_API_KEY`, `PREDICTHQ_API_KEY`, `SERPAPI_API_KEY` | Servicios externos (opcionales). |
| `SMTP_*` | Correo. |

Configuración centralizada en `src/config/env.ts` (obligatorias en producción con
`requireInProduction`).

## Base de datos — importante

> **Este trabajo NO ejecuta migraciones ni `prisma db push`.** Se han validado el
> esquema y el cliente con `prisma validate` / `prisma generate`, operaciones no
> destructivas. El modelo `Itinerario` ya disponía de las columnas necesarias
> (`ia_json Json?`, `ia_resumen`, `preferencias_json Json?`), por lo que las
> mejoras de trazabilidad **no requieren cambios de esquema** y son
> retrocompatibles con los itinerarios existentes.

## Integridad del despliegue

- No se han cambiado nombres de repos ni configuración de despliegue.
- Render/Neon siguen siendo desplegables: `build` y `start` intactos, solo se
  añadieron scripts `typecheck` y `test` (no afectan al arranque).

## Evidencia para la memoria

- `render.yaml` / configuración del servicio.
- Salida de `prisma validate` y `prisma generate`.
- Tabla de variables de entorno (Anexo B / D).

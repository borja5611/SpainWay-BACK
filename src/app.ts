import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import jwt from "@fastify/jwt";

import { env } from "./config/env";

import healthRoutes from "./modules/health/health.routes";
import comunidadesRoutes from "./modules/comunidades/comunidades.routes";
import provinciasRoutes from "./modules/provincias/provincias.routes";
import municipiosRoutes from "./modules/municipios/municipios.routes";
import categoriasPoiRoutes from "./modules/categorias-poi/categorias-poi.routes";
import poisRoutes from "./modules/pois/pois.routes";
import preferenciasRoutes from "./modules/preferencias/preferencias.routes";
import favoritosRoutes from "./modules/favoritos/favoritos.routes";
import itinerariosRoutes from "./modules/itinerarios/itinerarios.routes";
import usuariosRoutes from "./modules/usuarios/usuarios.routes";
import conversacionesRoutes from "./modules/conversaciones/conversaciones.routes";
import mensajesRoutes from "./modules/mensajes/mensajes.routes";
import interaccionesRoutes from "./modules/interacciones/interacciones.routes";
import analiticaRoutes from "./modules/analitica/analitica.routes";
import eventosRoutes from "./modules/eventos/eventos.routes";
import programacionPoiRoutes from "./modules/programacion-poi/programacion-poi.routes";
import authRoutes from "./modules/auth/auth.routes";
import poisDestacadosRoutes from "./modules/pois-destacados/pois-destacados.routes";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: [
      env.FRONTEND_URL,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  await app.register(jwt, {
    secret: "spainway-secret-dev",
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "SpainWay API",
        description: "API del backend de SpainWay",
        version: "1.0.0",
      },
      servers: [{ url: `http://localhost:${env.PORT}` }],
    },
  });

  await app.register(swaggerUI, {
    routePrefix: "/docs",
  });

  await app.register(healthRoutes, { prefix: "/api/health" });
  await app.register(comunidadesRoutes, { prefix: "/api/comunidades" });
  await app.register(provinciasRoutes, { prefix: "/api/provincias" });
  await app.register(municipiosRoutes, { prefix: "/api/municipios" });
  await app.register(categoriasPoiRoutes, { prefix: "/api/categorias-poi" });
  await app.register(poisRoutes, { prefix: "/api/pois" });
  await app.register(preferenciasRoutes, { prefix: "/api/preferencias" });
  await app.register(favoritosRoutes, { prefix: "/api/favoritos" });
  await app.register(itinerariosRoutes, { prefix: "/api/itinerarios" });
  await app.register(usuariosRoutes, { prefix: "/api/usuarios" });
  await app.register(conversacionesRoutes, { prefix: "/api/conversaciones" });
  await app.register(mensajesRoutes, { prefix: "/api/mensajes" });
  await app.register(interaccionesRoutes, { prefix: "/api/interacciones" });
  await app.register(analiticaRoutes, { prefix: "/api/analitica" });
  await app.register(eventosRoutes, { prefix: "/api/eventos" });
  await app.register(programacionPoiRoutes, { prefix: "/api/programacion-poi" });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(poisDestacadosRoutes, { prefix: "/api/pois-destacados" });

  return app;
}
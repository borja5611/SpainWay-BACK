// src/app.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";

import { env } from "./config/env";

import healthRoutes from "./modules/health/health.routes";
import comunidadesRoutes from "./modules/comunidades/comunidades.routes";
import provinciasRoutes from "./modules/provincias/provincias.routes";
import municipiosRoutes from "./modules/municipios/municipios.routes";
import categoriasPoiRoutes from "./modules/categorias-poi/categorias-poi.routes";
import poisRoutes from "./modules/pois/pois.routes";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true,
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "SpainWay API",
        description: "API del backend de SpainWay",
        version: "1.0.0",
      },
      servers: [
        {
          url: `http://localhost:${env.PORT}`,
        },
      ],
      tags: [
        { name: "Health", description: "Estado del backend" },
        { name: "Comunidades", description: "Gestión de comunidades" },
        { name: "Provincias", description: "Gestión de provincias" },
        { name: "Municipios", description: "Gestión de municipios" },
        { name: "CategoriasPoi", description: "Gestión de categorías de POI" },
        { name: "Pois", description: "Gestión de POIs" },
      ],
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

  return app;
}
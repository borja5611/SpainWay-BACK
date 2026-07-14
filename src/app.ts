import Fastify, { FastifyError } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
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
import recomendadorRoutes from "./modules/recomendador/recomendador.routes";
import restauracionRoutes from "./modules/restauracion/restuaracion.routes";
import eventosLiveRoutes from "./modules/eventos-live/eventos-live.routes";
import chatAccionesRoutes from "./modules/chat-acciones/chat-acciones.routes";
import meteorologiaRoutes from "./modules/meteorologia/meteorologia.routes";
import lugaresLocalesRoutes from "./modules/lugares-locales/lugares-locales.routes";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: [
      env.FRONTEND_URL,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://spain-way-front.vercel.app",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  const jwtSecret = process.env.JWT_SECRET;
  if (env.NODE_ENV === "production" && !jwtSecret) {
    throw new Error("JWT_SECRET es obligatorio en producción");
  }
  if (env.NODE_ENV === "production" && !process.env.PASSWORD_RESET_SECRET) {
    throw new Error("PASSWORD_RESET_SECRET es obligatorio en producción");
  }

  await app.register(jwt, {
    secret: jwtSecret || "spainway-secret-dev-local",
  });

  // Cabeceras de seguridad HTTP (nosniff, frameguard, HSTS, referrer-policy…).
  // Se desactiva la CSP porque esta instancia sirve Swagger UI en /docs y la CSP
  // por defecto de helmet bloquearía sus recursos.
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Límite de peticiones global como red de seguridad frente a abuso. Las rutas
  // sensibles (login, registro, recuperación de contraseña y generación con IA)
  // añaden límites más estrictos vía `config.rateLimit` en su propia definición.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
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
  await app.register(recomendadorRoutes, { prefix: "/api/recomendador" });
  await app.register(restauracionRoutes, { prefix: "/api/restauracion" });
  await app.register(eventosLiveRoutes, { prefix: "/api/eventos-live" });
  await app.register(chatAccionesRoutes, { prefix: "/api/chat-acciones" });
  await app.register(meteorologiaRoutes, { prefix: "/api/meteorologia" });
  await app.register(lugaresLocalesRoutes, { prefix: "/api/lugares-locales" });

  // Manejador de errores centralizado: registra el error completo en el servidor
  // pero nunca expone la traza ni el mensaje interno al cliente en producción
  // (evita fuga de información sensible en errores 5xx).
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error(error);
    const statusCode = error.statusCode ?? 500;
    const esProduccion = env.NODE_ENV === "production";

    if (statusCode >= 500) {
      return reply.code(statusCode).send({
        message: esProduccion ? "Error interno del servidor" : error.message,
      });
    }

    // Errores 4xx (validación de esquema, límite de peticiones…): el mensaje es
    // controlado y seguro de mostrar al cliente.
    return reply.code(statusCode).send({ message: error.message });
  });

  return app;
}
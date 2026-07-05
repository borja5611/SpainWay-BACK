// src/modules/health/health.routes.ts
import { FastifyInstance } from "fastify";
import { checkIaHealth } from "../../servicios/ia.service";

export default async function healthRoutes(app: FastifyInstance) {
  app.get("/", {
    schema: {
      tags: ["Health"],
      summary: "Comprobar estado del backend",
      response: {
        200: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: async () => {
      return {
        ok: true,
        message: "Backend funcionando correctamente",
      };
    },
  });

  // Estado del motor de recomendaciones (IA).
  //
  // IMPORTANTE: este endpoint es un endpoint de ESTADO, no una operación que
  // pueda fallar. Salvo un fallo crítico realmente inesperado devuelve SIEMPRE
  // 200 con un envelope controlado. El 503 desaparece del contrato para que el
  // frontend nunca lo trate como error fatal.
  app.get("/wake-ia", async (_request, reply) => {
    try {
      const health = await checkIaHealth();

      return reply.code(200).send({
        ok: true,
        data: {
          status: health.status, // ready | warming | unavailable
          iaReady: health.iaReady,
          retryable: health.status !== "ready",
          code: health.code, // IA_READY | IA_WARMING | IA_TIMEOUT | IA_UNAVAILABLE
          message: health.message,
          checkedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      // Blindaje final: aunque checkIaHealth ya normaliza todo, nunca dejamos
      // que un fallo inesperado se convierta en un 503 hacia el frontend.
      app.log.error({ err: error }, "wake-ia: fallo inesperado comprobando la IA");
      return reply.code(200).send({
        ok: true,
        data: {
          status: "unavailable",
          iaReady: false,
          retryable: true,
          code: "IA_UNAVAILABLE",
          message:
            "El motor de recomendaciones no está disponible ahora mismo. Puedes seguir preparando el viaje y reintentarlo.",
          checkedAt: new Date().toISOString(),
        },
      });
    }
  });
}

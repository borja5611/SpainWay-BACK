// src/modules/health/health.routes.ts
import { FastifyInstance } from "fastify";
import { ensureIaReady } from "../../servicios/ia.service";

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

  app.get("/wake-ia", async (_request, reply) => {
    const result = await ensureIaReady();

    if (result.ok) {
      return reply.send({
        ok: true,
        status: "ready",
        message: "Servicio de IA disponible",
      });
    }

    if (result.status === "cooldown") {
      return reply.code(503).send({
        ok: false,
        status: "cooldown",
        message: "El motor de recomendaciones se está preparando. Espera unos segundos antes de volver a intentarlo.",
      });
    }

    return reply.code(202).send({
      ok: false,
      status: "warming",
      message: "El motor de recomendaciones se está preparando. Espera unos segundos.",
    });
  });
}

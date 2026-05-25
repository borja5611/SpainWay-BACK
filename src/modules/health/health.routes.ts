// src/modules/health/health.routes.ts
import { FastifyInstance } from "fastify";

const IA_WAKE_TIMEOUT_MS = 15000;

async function pingIaService() {
  const baseUrl = (process.env.RECOMMENDER_API_URL || "https://spainway-ia.onrender.com").replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IA_WAKE_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      signal: controller.signal,
    });

    const data = await response.json().catch(() => null);

    return {
      ok: response.ok,
      status: response.status,
      serviceUrl: baseUrl,
      data,
    };
  } finally {
    clearTimeout(timeout);
  }
}

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

  app.get("/wake-ia", {
    schema: {
      tags: ["Health"],
      summary: "Despertar el servicio IA alojado en Render",
    },
    handler: async (_request, reply) => {
      try {
        const result = await pingIaService();
        return {
          ok: true,
          iaAwake: result.ok,
          status: result.status,
          serviceUrl: result.serviceUrl,
          data: result.data,
        };
      } catch (error) {
        // No rompemos el login si Render todavía está despertando.
        return reply.code(202).send({
          ok: true,
          iaAwake: false,
          message: "Wake-up enviado, pero el servicio IA todavía puede estar arrancando.",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}

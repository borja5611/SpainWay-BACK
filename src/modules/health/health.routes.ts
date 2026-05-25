// src/modules/health/health.routes.ts
import { FastifyInstance } from "fastify";

const IA_DEFAULT_URL = "https://spainway-ia.onrender.com";

function getIaBaseUrl(): string {
  return (process.env.RECOMMENDER_API_URL || IA_DEFAULT_URL).replace(/\/+$/, "");
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
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

  app.get("/wake-ia", async (_request, reply) => {
    const baseUrl = getIaBaseUrl();

    try {
      const response = await fetchWithTimeout(`${baseUrl}/health`, 20000);
      const text = await response.text();

      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }

      return reply.send({
        ok: response.ok,
        status: response.status,
        service: baseUrl,
        message: response.ok
          ? "IA despierta y disponible"
          : "La IA ha respondido, pero todavía no está disponible del todo",
        data,
      });
    } catch (error) {
      return reply.code(202).send({
        ok: false,
        service: baseUrl,
        message: "Se ha enviado la llamada de despertar a la IA, pero Render todavía puede estar arrancando.",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

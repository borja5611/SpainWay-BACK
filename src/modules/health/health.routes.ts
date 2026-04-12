// src/modules/health/health.routes.ts
import { FastifyInstance } from "fastify";

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
}
// src/modules/itinerarios/itinerarios.routes.ts
import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

export default async function itinerariosRoutes(app: FastifyInstance) {
  app.get("/:id_usuario", {
    schema: {
      tags: ["Itinerarios"],
      summary: "Listar itinerarios de un usuario",
      params: {
        type: "object",
        required: ["id_usuario"],
        properties: {
          id_usuario: { type: "integer" },
        },
      },
    },
    handler: async (request) => {
      const { id_usuario } = request.params as { id_usuario: number };

      const itinerarios = await prisma.itinerario.findMany({
        where: { id_usuario },
        include: {
          dias: {
            include: {
              elementos: {
                include: {
                  poi: true,
                },
              },
            },
            orderBy: { fecha: "asc" },
          },
        },
        orderBy: { creado: "desc" },
      });

      return itinerarios;
    },
  });
}
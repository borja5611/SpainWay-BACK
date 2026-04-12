// src/modules/comunidades/comunidades.routes.ts
import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

export default async function comunidadesRoutes(app: FastifyInstance) {
  app.get("/", {
    schema: {
      tags: ["Comunidades"],
      summary: "Listar comunidades",
    },
    handler: async () => {
      const comunidades = await prisma.comunidad.findMany({
        orderBy: { nombre: "asc" },
      });

      return comunidades;
    },
  });

  app.get("/:id", {
    schema: {
      tags: ["Comunidades"],
      summary: "Obtener detalle de una comunidad",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "integer" },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: number };

      const comunidad = await prisma.comunidad.findUnique({
        where: { id_CCAA: id },
      });

      if (!comunidad) {
        return reply.code(404).send({
          message: "Comunidad no encontrada",
        });
      }

      return comunidad;
    },
  });
}
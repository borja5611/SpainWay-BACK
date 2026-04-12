// src/modules/provincias/provincias.routes.ts
import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

export default async function provinciasRoutes(app: FastifyInstance) {
  app.get("/", {
    schema: {
      tags: ["Provincias"],
      summary: "Listar provincias",
    },
    handler: async () => {
      const provincias = await prisma.provincia.findMany({
        orderBy: { nombre: "asc" },
      });

      return provincias;
    },
  });

  app.get("/:id", {
    schema: {
      tags: ["Provincias"],
      summary: "Obtener detalle de una provincia",
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

      const provincia = await prisma.provincia.findUnique({
        where: { id_provincia: id },
      });

      if (!provincia) {
        return reply.code(404).send({
          message: "Provincia no encontrada",
        });
      }

      return provincia;
    },
  });

  app.get("/comunidad/:id_CCAA", {
    schema: {
      tags: ["Provincias"],
      summary: "Listar provincias de una comunidad",
      params: {
        type: "object",
        required: ["id_CCAA"],
        properties: {
          id_CCAA: { type: "integer" },
        },
      },
    },
    handler: async (request) => {
      const { id_CCAA } = request.params as { id_CCAA: number };

      const provincias = await prisma.provincia.findMany({
        where: { id_CCAA },
        orderBy: { nombre: "asc" },
      });

      return provincias;
    },
  });
}
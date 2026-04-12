// src/modules/municipios/municipios.routes.ts
import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

export default async function municipiosRoutes(app: FastifyInstance) {
  app.get("/", {
    schema: {
      tags: ["Municipios"],
      summary: "Listar municipios con paginación",
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, default: 1 },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
      },
    },
    handler: async (request) => {
      const { page = 1, limit = 50 } = request.query as {
        page?: number;
        limit?: number;
      };

      const skip = (page - 1) * limit;

      const [data, total] = await Promise.all([
        prisma.municipio.findMany({
          orderBy: { nombre: "asc" },
          skip,
          take: limit,
        }),
        prisma.municipio.count(),
      ]);

      return {
        page,
        limit,
        total,
        data,
      };
    },
  });

  app.get("/:id", {
    schema: {
      tags: ["Municipios"],
      summary: "Obtener detalle de un municipio",
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

      const municipio = await prisma.municipio.findUnique({
        where: { id_municipio: id },
      });

      if (!municipio) {
        return reply.code(404).send({
          message: "Municipio no encontrado",
        });
      }

      return municipio;
    },
  });

  app.get("/provincia/:id_provincia", {
    schema: {
      tags: ["Municipios"],
      summary: "Listar municipios de una provincia",
      params: {
        type: "object",
        required: ["id_provincia"],
        properties: {
          id_provincia: { type: "integer" },
        },
      },
    },
    handler: async (request) => {
      const { id_provincia } = request.params as { id_provincia: number };

      const municipios = await prisma.municipio.findMany({
        where: { id_provincia },
        orderBy: { nombre: "asc" },
      });

      return municipios;
    },
  });
}
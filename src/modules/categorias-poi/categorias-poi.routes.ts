// src/modules/categorias-poi/categorias-poi.routes.ts
import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

export default async function categoriasPoiRoutes(app: FastifyInstance) {
  app.get("/", {
    schema: {
      tags: ["CategoriasPoi"],
      summary: "Listar categorías de POI",
    },
    handler: async () => {
      const categorias = await prisma.categoria_poi.findMany({
        orderBy: { nombre: "asc" },
      });

      return categorias;
    },
  });

  app.get("/:id", {
    schema: {
      tags: ["CategoriasPoi"],
      summary: "Obtener detalle de una categoría de POI",
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

      const categoria = await prisma.categoria_poi.findUnique({
        where: { id_categoria_poi: id },
      });

      if (!categoria) {
        return reply.code(404).send({
          message: "Categoría no encontrada",
        });
      }

      return categoria;
    },
  });
}
// src/modules/pois/pois.routes.ts
import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

export default async function poisRoutes(app: FastifyInstance) {
  app.get("/", {
    schema: {
      tags: ["Pois"],
      summary: "Listar POIs con paginación y filtros básicos",
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, default: 1 },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 20 },
          q: { type: "string" },
          id_categoria_poi: { type: "integer" },
          id_municipio: { type: "integer" },
        },
      },
    },
    handler: async (request) => {
      const {
        page = 1,
        limit = 20,
        q,
        id_categoria_poi,
        id_municipio,
      } = request.query as {
        page?: number;
        limit?: number;
        q?: string;
        id_categoria_poi?: number;
        id_municipio?: number;
      };

      const skip = (page - 1) * limit;

      const where = {
        ...(q
          ? {
              OR: [
                { nombre: { contains: q, mode: "insensitive" as const } },
                { descripcion: { contains: q, mode: "insensitive" as const } },
                { direccion: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
        ...(id_categoria_poi ? { id_categoria_poi } : {}),
        ...(id_municipio ? { id_municipio } : {}),
      };

      const [data, total] = await Promise.all([
        prisma.poi.findMany({
          where,
          include: {
            municipio: true,
            categoria_poi: true,
          },
          orderBy: { nombre: "asc" },
          skip,
          take: limit,
        }),
        prisma.poi.count({ where }),
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
      tags: ["Pois"],
      summary: "Obtener detalle de un POI",
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

      const poi = await prisma.poi.findUnique({
        where: { id_poi: id },
        include: {
          municipio: true,
          categoria_poi: true,
        },
      });

      if (!poi) {
        return reply.code(404).send({
          message: "POI no encontrado",
        });
      }

      return poi;
    },
  });

  app.get("/id-global/:id_global", {
    schema: {
      tags: ["Pois"],
      summary: "Obtener detalle de un POI por id_global",
      params: {
        type: "object",
        required: ["id_global"],
        properties: {
          id_global: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { id_global } = request.params as { id_global: string };

      const poi = await prisma.poi.findUnique({
        where: { id_global },
        include: {
          municipio: true,
          categoria_poi: true,
        },
      });

      if (!poi) {
        return reply.code(404).send({
          message: "POI no encontrado",
        });
      }

      return poi;
    },
  });

  app.get("/municipio/:id_municipio", {
    schema: {
      tags: ["Pois"],
      summary: "Listar POIs de un municipio",
      params: {
        type: "object",
        required: ["id_municipio"],
        properties: {
          id_municipio: { type: "integer" },
        },
      },
    },
    handler: async (request) => {
      const { id_municipio } = request.params as { id_municipio: number };

      const pois = await prisma.poi.findMany({
        where: { id_municipio },
        include: {
          municipio: true,
          categoria_poi: true,
        },
        orderBy: { nombre: "asc" },
      });

      return pois;
    },
  });

  app.get("/categoria/:id_categoria_poi", {
    schema: {
      tags: ["Pois"],
      summary: "Listar POIs por categoría",
      params: {
        type: "object",
        required: ["id_categoria_poi"],
        properties: {
          id_categoria_poi: { type: "integer" },
        },
      },
    },
    handler: async (request) => {
      const { id_categoria_poi } = request.params as { id_categoria_poi: number };

      const pois = await prisma.poi.findMany({
        where: { id_categoria_poi },
        include: {
          municipio: true,
          categoria_poi: true,
        },
        orderBy: { nombre: "asc" },
      });

      return pois;
    },
  });

  app.get("/busqueda/texto", {
    schema: {
      tags: ["Pois"],
      summary: "Buscar POIs por texto",
      querystring: {
        type: "object",
        required: ["q"],
        properties: {
          q: { type: "string" },
        },
      },
    },
    handler: async (request) => {
      const { q } = request.query as { q: string };

      const pois = await prisma.poi.findMany({
        where: {
          OR: [
            { nombre: { contains: q, mode: "insensitive" } },
            { descripcion: { contains: q, mode: "insensitive" } },
            { direccion: { contains: q, mode: "insensitive" } },
          ],
        },
        include: {
          municipio: true,
          categoria_poi: true,
        },
        take: 50,
      });

      return pois;
    },
  });
}
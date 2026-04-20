import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

function normalizeParam(value: string) {
  return decodeURIComponent(value).trim();
}

export default async function poisDestacadosRoutes(app: FastifyInstance) {
  app.get("/comunidad/:ccaa", async (request) => {
    const { ccaa } = request.params as { ccaa: string };
    const comunidad = normalizeParam(ccaa);

    return prisma.poi_destacado_ccaa.findMany({
      where: { comunidad },
      orderBy: [
        { prioridad_fuente: "desc" },
        { match_confianza: "desc" },
      ],
      include: { poi: true },
    });
  });

  app.get("/comunidad/:ccaa/must-see", async (request) => {
    const { ccaa } = request.params as { ccaa: string };
    const comunidad = normalizeParam(ccaa);

    return prisma.poi_destacado_ccaa.findMany({
      where: {
        comunidad,
        prioridad_fuente: {
          gte: 10,
        },
      },
      orderBy: [
        { prioridad_fuente: "desc" },
        { match_confianza: "desc" },
      ],
      include: { poi: true },
    });
  });

  app.get("/comunidad/:ccaa/secundarios", async (request) => {
    const { ccaa } = request.params as { ccaa: string };
    const comunidad = normalizeParam(ccaa);

    return prisma.poi_destacado_ccaa.findMany({
      where: {
        comunidad,
        prioridad_fuente: {
          lt: 10,
        },
      },
      orderBy: [
        { prioridad_fuente: "desc" },
        { match_confianza: "desc" },
      ],
      include: { poi: true },
    });
  });

  app.get("/municipio/:municipio", async (request) => {
    const { municipio } = request.params as { municipio: string };
    const ciudad_fuente = normalizeParam(municipio);

    return prisma.poi_destacado_ccaa.findMany({
      where: { ciudad_fuente },
      orderBy: [
        { prioridad_fuente: "desc" },
        { match_confianza: "desc" },
      ],
      include: { poi: true },
    });
  });

  app.get("/provincia/:provincia", async (request) => {
    const { provincia } = request.params as { provincia: string };
    const provincia_fuente = normalizeParam(provincia);

    return prisma.poi_destacado_ccaa.findMany({
      where: { provincia_fuente },
      orderBy: [
        { prioridad_fuente: "desc" },
        { match_confianza: "desc" },
      ],
      include: { poi: true },
    });
  });

  app.get("/search", async (request, reply) => {
    const { q } = request.query as { q?: string };

    if (!q || !q.trim()) {
      return reply.code(400).send({
        message: "Debes indicar el parámetro q",
      });
    }

    const query = q.trim();

    return prisma.poi_destacado_ccaa.findMany({
      where: {
        OR: [
          {
            poi_canonico: {
              contains: query,
              mode: "insensitive",
            },
          },
          {
            comunidad: {
              contains: query,
              mode: "insensitive",
            },
          },
          {
            ciudad_fuente: {
              contains: query,
              mode: "insensitive",
            },
          },
          {
            provincia_fuente: {
              contains: query,
              mode: "insensitive",
            },
          },
          {
            poi: {
              nombre: {
                contains: query,
                mode: "insensitive",
              },
            },
          },
        ],
      },
      orderBy: [
        { prioridad_fuente: "desc" },
        { match_confianza: "desc" },
      ],
      include: { poi: true },
      take: 50,
    });
  });
}
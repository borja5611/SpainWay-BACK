import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

function normalizeParam(value: string) {
  return decodeURIComponent(value).trim();
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function aliasesComunidad(value: string): string[] {
  const normalized = normalizeText(value);

  if (normalized === "baleares" || normalized === "illes balears") {
    return ["Baleares", "Illes Balears"];
  }

  if (
    normalized === "madrid" ||
    normalized === "comunidad de madrid"
  ) {
    return ["Madrid", "Comunidad de Madrid"];
  }

  if (
    normalized === "cataluna" ||
    normalized === "catalunya" ||
    normalized === "cataluña"
  ) {
    return ["Cataluña", "Catalunya"];
  }

  if (
    normalized === "valencia" ||
    normalized === "comunidad valenciana"
  ) {
    return ["Comunidad Valenciana", "Valencia"];
  }

  return [value];
}

const includePoiCompleto = {
  poi: {
    include: {
      municipio: {
        include: {
          provincia: {
            include: {
              comunidad: true,
            },
          },
        },
      },
      categoria_poi: true,
    },
  },
};

export default async function poisDestacadosRoutes(app: FastifyInstance) {
  app.get("/comunidad/:ccaa", async (request) => {
    const { ccaa } = request.params as { ccaa: string };
    const comunidad = normalizeParam(ccaa);
    const comunidades = aliasesComunidad(comunidad);

    return prisma.poi_destacado_ccaa.findMany({
      where: { comunidad: { in: comunidades } },
      orderBy: [{ prioridad_fuente: "desc" }, { match_confianza: "desc" }],
      include: includePoiCompleto,
    });
  });

  app.get("/comunidad/:ccaa/must-see", async (request) => {
    const { ccaa } = request.params as { ccaa: string };
    const comunidad = normalizeParam(ccaa);
    const comunidades = aliasesComunidad(comunidad);

    return prisma.poi_destacado_ccaa.findMany({
      where: {
        comunidad: { in: comunidades },
        prioridad_fuente: { gte: 10 },
      },
      orderBy: [{ prioridad_fuente: "desc" }, { match_confianza: "desc" }],
      include: includePoiCompleto,
    });
  });

  app.get("/comunidad/:ccaa/secundarios", async (request) => {
    const { ccaa } = request.params as { ccaa: string };
    const comunidad = normalizeParam(ccaa);
    const comunidades = aliasesComunidad(comunidad);

    return prisma.poi_destacado_ccaa.findMany({
      where: {
        comunidad: { in: comunidades },
        prioridad_fuente: { lt: 10 },
      },
      orderBy: [{ prioridad_fuente: "desc" }, { match_confianza: "desc" }],
      include: includePoiCompleto,
    });
  });

  app.get("/municipio/:municipio", async (request) => {
    const { municipio } = request.params as { municipio: string };
    const ciudad_fuente = normalizeParam(municipio);

    return prisma.poi_destacado_ccaa.findMany({
      where: { ciudad_fuente },
      orderBy: [{ prioridad_fuente: "desc" }, { match_confianza: "desc" }],
      include: includePoiCompleto,
    });
  });

  app.get("/provincia/:provincia", async (request) => {
    const { provincia } = request.params as { provincia: string };
    const provincia_fuente = normalizeParam(provincia);

    return prisma.poi_destacado_ccaa.findMany({
      where: { provincia_fuente },
      orderBy: [{ prioridad_fuente: "desc" }, { match_confianza: "desc" }],
      include: includePoiCompleto,
    });
  });

  app.get("/search", async (request, reply) => {
    const { q } = request.query as { q?: string };

    if (!q || !q.trim()) {
      return reply.code(400).send({ message: "Debes indicar el parámetro q" });
    }

    const query = q.trim();
    const comunidadesAlias = aliasesComunidad(query);

    return prisma.poi_destacado_ccaa.findMany({
      where: {
        OR: [
          { poi_canonico: { contains: query, mode: "insensitive" } },
          { comunidad: { in: comunidadesAlias } },
          { comunidad: { contains: query, mode: "insensitive" } },
          { ciudad_fuente: { contains: query, mode: "insensitive" } },
          { provincia_fuente: { contains: query, mode: "insensitive" } },
          { poi: { nombre: { contains: query, mode: "insensitive" } } },
        ],
      },
      orderBy: [{ prioridad_fuente: "desc" }, { match_confianza: "desc" }],
      include: includePoiCompleto,
      take: 50,
    });
  });
}
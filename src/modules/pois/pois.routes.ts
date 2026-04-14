import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

function toInt(value: unknown): number | null {
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

export default async function poisRoutes(app: FastifyInstance) {
  app.get("/id-global/:id_global", async (request, reply) => {
    const { id_global } = request.params as { id_global: string };

    const poi = await prisma.poi.findUnique({
      where: { id_global },
      include: {
        municipio: true,
        categoria_poi: true,
      },
    });

    if (!poi) {
      return reply.code(404).send({ message: "POI no encontrado" });
    }

    return poi;
  });

  app.get("/municipio/:id_municipio", async (request, reply) => {
    const params = request.params as { id_municipio: string };
    const id_municipio = toInt(params.id_municipio);

    if (id_municipio === null) {
      return reply.code(400).send({ message: "id_municipio inválido" });
    }

    const pois = await prisma.poi.findMany({
      where: { id_municipio },
      include: {
        municipio: true,
        categoria_poi: true,
      },
      orderBy: { nombre: "asc" },
    });

    return pois;
  });

  app.get("/categoria/:id_categoria_poi", async (request, reply) => {
    const params = request.params as { id_categoria_poi: string };
    const id_categoria_poi = toInt(params.id_categoria_poi);

    if (id_categoria_poi === null) {
      return reply.code(400).send({ message: "id_categoria_poi inválido" });
    }

    const pois = await prisma.poi.findMany({
      where: { id_categoria_poi },
      include: {
        municipio: true,
        categoria_poi: true,
      },
      orderBy: { nombre: "asc" },
    });

    return pois;
  });

  app.get("/busqueda/texto", async (request) => {
    const { q } = request.query as { q?: string };

    if (!q || !q.trim()) {
      return [];
    }

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
      orderBy: { nombre: "asc" },
    });

    return pois;
  });

  app.get("/explorar", async (request) => {
    const query = request.query as Record<string, string | undefined>;

    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 20)));
    const skip = (page - 1) * limit;

    const q = query.q?.trim();
    const id_CCAA = toInt(query.id_CCAA);
    const id_provincia = toInt(query.id_provincia);
    const id_municipio = toInt(query.id_municipio);
    const id_categoria_poi = toInt(query.id_categoria_poi);
    const tipo = query.tipo?.trim();

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
      ...(id_categoria_poi !== null ? { id_categoria_poi } : {}),
      ...(id_municipio !== null ? { id_municipio } : {}),
      ...(tipo ? { tipo: { contains: tipo, mode: "insensitive" as const } } : {}),
      ...(id_provincia !== null
        ? {
            municipio: {
              id_provincia,
            },
          }
        : {}),
      ...(id_CCAA !== null
        ? {
            municipio: {
              provincia: {
                id_CCAA,
              },
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      prisma.poi.findMany({
        where,
        include: {
          municipio: {
            include: {
              provincia: true,
            },
          },
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
  });

  app.get("/cercanos", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;

    const lat = Number(query.lat);
    const lon = Number(query.lon);
    const radioKm = Number(query.radioKm ?? 10);
    const limit = Number(query.limit ?? 20);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return reply.code(400).send({ message: "lat y lon son obligatorios y deben ser numéricos" });
    }

    const latDelta = radioKm / 111;
    const lonDelta = radioKm / (111 * Math.cos((lat * Math.PI) / 180));

    const candidatos = await prisma.poi.findMany({
      where: {
        latitud: {
          gte: lat - latDelta,
          lte: lat + latDelta,
        },
        longitud: {
          gte: lon - lonDelta,
          lte: lon + lonDelta,
        },
      },
      include: {
        municipio: true,
        categoria_poi: true,
      },
    });

    const cercanos = candidatos
      .filter((poi) => poi.latitud !== null && poi.longitud !== null)
      .map((poi) => {
        const distanciaKm = haversineKm(lat, lon, poi.latitud!, poi.longitud!);
        return { ...poi, distanciaKm };
      })
      .filter((poi) => poi.distanciaKm <= radioKm)
      .sort((a, b) => a.distanciaKm - b.distanciaKm)
      .slice(0, limit);

    return cercanos;
  });

  app.get("/destacados", async (request) => {
    const query = request.query as Record<string, string | undefined>;

    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const id_categoria_poi = toInt(query.id_categoria_poi);
    const id_municipio = toInt(query.id_municipio);

    const pois = await prisma.poi.findMany({
      where: {
        ...(id_categoria_poi !== null ? { id_categoria_poi } : {}),
        ...(id_municipio !== null ? { id_municipio } : {}),
      },
      include: {
        municipio: true,
        categoria_poi: true,
      },
      orderBy: [
        { popularidad: "desc" },
        { puntuacion: "desc" },
        { nombre: "asc" },
      ],
      take: limit,
    });

    return pois;
  });

  app.get("/", async (request) => {
    const query = request.query as Record<string, string | undefined>;

    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 20)));
    const skip = (page - 1) * limit;

    const q = query.q?.trim();
    const id_categoria_poi = toInt(query.id_categoria_poi);
    const id_municipio = toInt(query.id_municipio);

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
      ...(id_categoria_poi !== null ? { id_categoria_poi } : {}),
      ...(id_municipio !== null ? { id_municipio } : {}),
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
  });

  app.get("/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const id = toInt(params.id);

    if (id === null) {
      return reply.code(400).send({ message: "id inválido" });
    }

    const poi = await prisma.poi.findUnique({
      where: { id_poi: id },
      include: {
        municipio: true,
        categoria_poi: true,
      },
    });

    if (!poi) {
      return reply.code(404).send({ message: "POI no encontrado" });
    }

    return poi;
  });

    app.get("/filtros", async () => {
    const [comunidades, provincias, categorias, tipos] = await Promise.all([
      prisma.comunidad.findMany({
        orderBy: { nombre: "asc" },
      }),
      prisma.provincia.findMany({
        orderBy: { nombre: "asc" },
      }),
      prisma.categoria_poi.findMany({
        orderBy: { nombre: "asc" },
      }),
      prisma.poi.findMany({
        distinct: ["tipo"],
        select: { tipo: true },
        orderBy: { tipo: "asc" },
      }),
    ]);

    return {
      comunidades,
      provincias,
      categorias,
      tipos: tipos
        .map((t) => t.tipo)
        .filter((t) => t !== null && t !== ""),
    };
  });
}
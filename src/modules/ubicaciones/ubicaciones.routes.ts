import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

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

export default async function ubicacionesRoutes(app: FastifyInstance) {
  app.get("/sugerencias", async (request) => {
    const query = request.query as {
      q?: string;
      lat?: string;
      lon?: string;
      limit?: string;
    };

    const q = query.q?.trim();
    const limit = Math.min(15, Math.max(1, Number(query.limit ?? 8)));

    if (!q || q.length < 2) {
      return [];
    }

    const [pois, municipios] = await Promise.all([
      prisma.poi.findMany({
        where: {
          OR: [
            { nombre: { contains: q, mode: "insensitive" } },
            { direccion: { contains: q, mode: "insensitive" } },
            {
              municipio: {
                nombre: { contains: q, mode: "insensitive" },
              },
            },
          ],
          latitud: { not: null },
          longitud: { not: null },
        },
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
        take: limit,
      }),

      prisma.municipio.findMany({
        where: {
          nombre: { contains: q, mode: "insensitive" },
          latitud: { not: null },
          longitud: { not: null },
        },
        include: {
          provincia: {
            include: {
              comunidad: true,
            },
          },
        },
        take: limit,
      }),
    ]);

    const baseLat = Number(query.lat);
    const baseLon = Number(query.lon);
    const hasBase = Number.isFinite(baseLat) && Number.isFinite(baseLon);

    const poiItems = pois.map((poi) => {
      const distanciaKm =
        hasBase && poi.latitud !== null && poi.longitud !== null
          ? haversineKm(baseLat, baseLon, poi.latitud, poi.longitud)
          : null;

      return {
        id: `poi:${poi.id_poi}`,
        source: "poi",
        label: poi.nombre,
        subtitle: [
          poi.municipio?.nombre,
          poi.municipio?.provincia?.nombre,
          poi.municipio?.provincia?.comunidad?.nombre,
        ]
          .filter(Boolean)
          .join(", "),
        address: poi.direccion,
        lat: poi.latitud,
        lon: poi.longitud,
        tipo: poi.tipo,
        categoria: poi.categoria_poi?.nombre,
        distanciaKm,
      };
    });

    const municipioItems = municipios.map((m) => {
      const distanciaKm =
        hasBase && m.latitud !== null && m.longitud !== null
          ? haversineKm(baseLat, baseLon, m.latitud, m.longitud)
          : null;

      return {
        id: `municipio:${m.id_municipio}`,
        source: "municipio",
        label: m.nombre,
        subtitle: [m.provincia?.nombre, m.provincia?.comunidad?.nombre]
          .filter(Boolean)
          .join(", "),
        address: null,
        lat: m.latitud,
        lon: m.longitud,
        tipo: "zona",
        categoria: "Municipio",
        distanciaKm,
      };
    });

    return [...poiItems, ...municipioItems]
      .sort((a, b) => {
        if (a.distanciaKm === null && b.distanciaKm === null) {
          return a.label.localeCompare(b.label);
        }
        if (a.distanciaKm === null) return 1;
        if (b.distanciaKm === null) return -1;
        return a.distanciaKm - b.distanciaKm;
      })
      .slice(0, limit);
  });
}
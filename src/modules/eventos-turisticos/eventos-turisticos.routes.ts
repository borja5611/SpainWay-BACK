import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

function getEventoTuristicoDelegate() {
  const client = prisma as any;

  const delegate =
    client.eventoTuristico ??
    client.evento_Turistico ??
    client.evento_turistico;

  if (!delegate) {
    throw new Error(
      "No se encontró el modelo EventoTuristico/Evento_Turistico en Prisma. Ejecuta npx prisma generate y revisa el nombre del modelo en schema.prisma."
    );
  }

  return delegate;
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

export default async function eventosTuristicosRoutes(app: FastifyInstance) {
  const eventoTuristico = getEventoTuristicoDelegate();

  app.get("/", async (request, reply) => {
    const query = request.query as {
      ciudad?: string;
      provincia?: string;
      comunidad?: string;
      desde?: string;
      hasta?: string;
      activo?: string;
      limit?: string;
    };

    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50)));

    const where: any = {};

    if (query.ciudad) {
      where.ciudad = {
        contains: query.ciudad,
        mode: "insensitive",
      };
    }

    if (query.provincia) {
      where.provincia = {
        contains: query.provincia,
        mode: "insensitive",
      };
    }

    if (query.comunidad) {
      where.comunidad = {
        contains: query.comunidad,
        mode: "insensitive",
      };
    }

    if (query.activo !== undefined) {
      where.activo = query.activo === "true";
    }

    if (query.desde || query.hasta) {
      where.inicio = {};

      if (query.desde) {
        where.inicio.gte = new Date(query.desde);
      }

      if (query.hasta) {
        where.inicio.lte = new Date(query.hasta);
      }
    }

    const eventos = await eventoTuristico.findMany({
      where,
      orderBy: {
        inicio: "asc",
      },
      take: limit,
    });

    return reply.send(eventos);
  });

  app.get("/cercanos", async (request, reply) => {
    const query = request.query as {
      lat?: string;
      lon?: string;
      radioKm?: string;
      desde?: string;
      hasta?: string;
      limit?: string;
    };

    const lat = Number(query.lat);
    const lon = Number(query.lon);
    const radioKm = Number(query.radioKm ?? 20);
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 30)));

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return reply.code(400).send({
        message: "lat y lon son obligatorios",
      });
    }

    const latDelta = radioKm / 111;
    const lonDelta = radioKm / (111 * Math.cos((lat * Math.PI) / 180));

    const where: any = {
      activo: true,
      latitud: {
        gte: lat - latDelta,
        lte: lat + latDelta,
      },
      longitud: {
        gte: lon - lonDelta,
        lte: lon + lonDelta,
      },
    };

    if (query.desde || query.hasta) {
      where.inicio = {};

      if (query.desde) {
        where.inicio.gte = new Date(query.desde);
      }

      if (query.hasta) {
        where.inicio.lte = new Date(query.hasta);
      }
    }

    const candidatos = await eventoTuristico.findMany({
      where,
      orderBy: {
        inicio: "asc",
      },
    });

    const eventos = candidatos
      .filter((evento: any) => evento.latitud !== null && evento.longitud !== null)
      .map((evento: any) => ({
        ...evento,
        distanciaKm: haversineKm(
          lat,
          lon,
          Number(evento.latitud),
          Number(evento.longitud)
        ),
      }))
      .filter((evento: any) => evento.distanciaKm <= radioKm)
      .sort((a: any, b: any) => {
        const inicioA = new Date(a.inicio).getTime();
        const inicioB = new Date(b.inicio).getTime();

        if (inicioA !== inicioB) {
          return inicioA - inicioB;
        }

        return a.distanciaKm - b.distanciaKm;
      })
      .slice(0, limit);

    return reply.send(eventos);
  });

  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const idEvento = Number(id);

    if (!Number.isInteger(idEvento)) {
      return reply.code(400).send({
        message: "id inválido",
      });
    }

    const evento = await eventoTuristico.findUnique({
      where: {
        id_evento_turistico: idEvento,
      },
    });

    if (!evento) {
      return reply.code(404).send({
        message: "Evento turístico no encontrado",
      });
    }

    return reply.send(evento);
  });
}
import { FastifyInstance } from "fastify";
import { obtenerContextoMeteorologicoSpainWay } from "./meteorologia.service";

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default async function meteorologiaRoutes(app: FastifyInstance) {
  app.get("/contexto", async (request, reply) => {
    const query = request.query as {
      lat?: string;
      lon?: string;
      start?: string;
      end?: string;
      days?: string;
    };

    const lat = toNumber(query.lat);
    const lon = toNumber(query.lon);

    if (lat === null || lon === null) {
      return reply.code(400).send({ message: "lat y lon son obligatorios" });
    }

    const dates = [query.start, query.end].filter(Boolean) as string[];
    const days = Number.isFinite(Number(query.days)) ? Number(query.days) : undefined;

    const contexto = await obtenerContextoMeteorologicoSpainWay({
      lat,
      lon,
      dates,
      days,
    });

    return {
      ok: true,
      contexto,
    };
  });
}

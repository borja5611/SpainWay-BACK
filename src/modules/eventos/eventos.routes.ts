import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export default async function eventosRoutes(app: FastifyInstance) {
  app.get("/", async () => {
    const eventos = await prisma.evento.findMany({
      include: {
        municipio: true,
      },
      orderBy: { inicio: "asc" },
    });

    return eventos;
  });

  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const idEvento = toInt(id);

    if (idEvento === null) {
      return reply.code(400).send({ message: "id inválido" });
    }

    const evento = await prisma.evento.findUnique({
      where: { id_evento: idEvento },
      include: {
        municipio: true,
      },
    });

    if (!evento) {
      return reply.code(404).send({ message: "Evento no encontrado" });
    }

    return evento;
  });

  app.get("/municipio/:id_municipio", async (request, reply) => {
    const { id_municipio } = request.params as { id_municipio: string };
    const idMunicipio = toInt(id_municipio);

    if (idMunicipio === null) {
      return reply.code(400).send({ message: "id_municipio inválido" });
    }

    const eventos = await prisma.evento.findMany({
      where: { id_municipio: idMunicipio },
      include: {
        municipio: true,
      },
      orderBy: { inicio: "asc" },
    });

    return eventos;
  });
}
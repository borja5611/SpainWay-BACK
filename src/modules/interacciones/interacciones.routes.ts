import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export default async function itinerariosRoutes(app: FastifyInstance) {
  app.get("/:id_usuario", async (request, reply) => {
    const { id_usuario } = request.params as { id_usuario: string };
    const usuarioId = toInt(id_usuario);

    if (usuarioId === null) {
      return reply.code(400).send({ message: "id_usuario inválido" });
    }

    const itinerarios = await prisma.itinerario.findMany({
      where: { id_usuario: usuarioId },
      include: {
        eventos: {
          include: {
            evento_turistico: true,
          },
        },
        dias: {
          orderBy: {
            fecha: "asc",
          },
          include: {
            eventos: {
              include: {
                evento_turistico: true,
              },
            },
            elementos: {
              orderBy: {
                orden: "asc",
              },
              include: {
                poi: {
                  include: {
                    municipio: true,
                    categoria_poi: true,
                    destacados_ccaa: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        creado: "desc",
      },
    });

    return itinerarios;
  });

  app.get("/resumen/:id_usuario", async (request, reply) => {
    const { id_usuario } = request.params as { id_usuario: string };
    const usuarioId = toInt(id_usuario);

    if (usuarioId === null) {
      return reply.code(400).send({ message: "id_usuario inválido" });
    }

    const itinerarios = await prisma.itinerario.findMany({
      where: { id_usuario: usuarioId },
      select: {
        id_itinerario: true,
        titulo: true,
        destino: true,
        inicio: true,
        fin: true,
        presupuesto: true,
        transporte: true,
        accesibilidad: true,
        estado: true,
        creado: true,
        actualizado: true,
      },
      orderBy: { creado: "desc" },
    });

    return itinerarios;
  });
}
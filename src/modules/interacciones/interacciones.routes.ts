import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import {
  requiereAutenticacion,
  validarPropiedadRecurso,
  toInt,
} from "../../hooks/auth.hook";

// NOTA (deuda técnica, ahora securizada): este módulo se monta en
// `/api/interacciones` (ver app.ts) pero su contenido es un duplicado heredado
// de las rutas de itinerarios y el frontend no lo consume. Hasta esta revisión
// exponía los itinerarios de CUALQUIER usuario sin autenticación (IDOR); ahora
// exige token válido y propiedad del recurso. Recomendación: eliminarlo o
// reimplementarlo sobre el modelo Item_interaccion.
export default async function itinerariosRoutes(app: FastifyInstance) {
  app.get(
    "/:id_usuario",
    { preHandler: [requiereAutenticacion, validarPropiedadRecurso("id_usuario")] },
    async (request, reply) => {
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
    }
  );

  app.get(
    "/resumen/:id_usuario",
    { preHandler: [requiereAutenticacion, validarPropiedadRecurso("id_usuario")] },
    async (request, reply) => {
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
    }
  );
}
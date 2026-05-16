import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma";

type GuardarSeleccionBody = {
  id_dia_itinerario?: number;
  momento?: string;
  id_lugar_restauracion?: number;
  id_poi_referencia?: number | null;
};

type GuardarSeleccionParams = {
  itinerarioId: string;
};

export async function guardarSeleccion(
  req: FastifyRequest<{
    Params: GuardarSeleccionParams;
    Body: GuardarSeleccionBody;
  }>,
  reply: FastifyReply
) {
  try {
    const { itinerarioId } = req.params;
    const {
      id_dia_itinerario,
      momento,
      id_lugar_restauracion,
      id_poi_referencia,
    } = req.body;

    if (!itinerarioId || !id_dia_itinerario || !momento || !id_lugar_restauracion) {
      return reply.code(400).send({
        error: "Faltan datos obligatorios",
      });
    }

    const saved = await prisma.itinerarioRestauracion.upsert({
      where: {
        id_itinerario_id_dia_itinerario_momento: {
          id_itinerario: Number(itinerarioId),
          id_dia_itinerario: Number(id_dia_itinerario),
          momento,
        },
      },
      update: {
        id_lugar_restauracion: Number(id_lugar_restauracion),
        id_poi_referencia: id_poi_referencia ? Number(id_poi_referencia) : null,
      },
      create: {
        id_itinerario: Number(itinerarioId),
        id_dia_itinerario: Number(id_dia_itinerario),
        momento,
        id_lugar_restauracion: Number(id_lugar_restauracion),
        id_poi_referencia: id_poi_referencia ? Number(id_poi_referencia) : null,
      },
      include: {
        lugar: true,
      },
    });

    return reply.send(saved);
  } catch (e) {
    console.error("Error guardando selección de restauración:", e);
    return reply.code(500).send({
      error: "Error guardando selección",
    });
  }
}
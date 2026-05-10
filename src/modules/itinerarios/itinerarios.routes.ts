import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import {
  applyManualItineraryAction,
  regeneratePartialDay,
  resumenDiaActualizado,
  type ManualItineraryAction,
} from "./itinerario-edicion.service";

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function toDateOrNull(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const includeItinerarioCompleto = {
  dias: {
    orderBy: { fecha: "asc" as const },
    include: {
      elementos: {
        orderBy: { orden: "asc" as const },
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
      eventos: {
        include: {
          evento_turistico: true,
        },
      },
    },
  },
  eventos: {
    include: {
      evento_turistico: true,
    },
  },
};

export default async function itinerariosRoutes(app: FastifyInstance) {
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
        id_usuario: true,
        base_nombre: true,
        base_direccion: true,
        base_latitud: true,
        base_longitud: true,
        permite_excursiones: true,
        radio_max_km: true,
        ia_resumen: true,
        ia_json: true,
        preferencias_json: true,
        dias: {
          select: {
            id_dia_itinerario: true,
            elementos: {
              select: {
                id_elemento_itinerario: true,
              },
            },
          },
        },
      },
      orderBy: { creado: "desc" },
    });

    return itinerarios;
  });

  app.get("/detalle/:id_itinerario", async (request, reply) => {
    const { id_itinerario } = request.params as { id_itinerario: string };
    const itinerarioId = toInt(id_itinerario);

    if (itinerarioId === null) {
      return reply.code(400).send({ message: "id_itinerario inválido" });
    }

    const itinerario = await prisma.itinerario.findUnique({
      where: { id_itinerario: itinerarioId },
      include: includeItinerarioCompleto,
    });

    if (!itinerario) {
      return reply.code(404).send({ message: "Itinerario no encontrado" });
    }

    return itinerario;
  });

  app.get("/:id_usuario", async (request, reply) => {
    const { id_usuario } = request.params as { id_usuario: string };
    const usuarioId = toInt(id_usuario);

    if (usuarioId === null) {
      return reply.code(400).send({ message: "id_usuario inválido" });
    }

    const itinerarios = await prisma.itinerario.findMany({
      where: { id_usuario: usuarioId },
      include: includeItinerarioCompleto,
      orderBy: { creado: "desc" },
    });

    return itinerarios;
  });

  app.post("/", async (request, reply) => {
    const body = request.body as {
      id_usuario?: number;
      titulo?: string;
      destino?: string;
      inicio?: string;
      fin?: string;
      presupuesto?: number;
      transporte?: string;
      accesibilidad?: string;
      estado?: string;
    };

    const usuarioId = toInt(body.id_usuario);
    if (usuarioId === null) {
      return reply.code(400).send({ message: "id_usuario inválido" });
    }

    const usuario = await prisma.usuario.findUnique({ where: { id_usuario: usuarioId } });
    if (!usuario) {
      return reply.code(404).send({ message: "Usuario no encontrado" });
    }

    const itinerario = await prisma.itinerario.create({
      data: {
        id_usuario: usuarioId,
        titulo: body.titulo?.trim() || "Nuevo itinerario",
        destino: body.destino?.trim() || null,
        inicio: toDateOrNull(body.inicio),
        fin: toDateOrNull(body.fin),
        presupuesto: body.presupuesto ?? null,
        transporte: body.transporte?.trim() || null,
        accesibilidad: body.accesibilidad?.trim() || null,
        estado: body.estado?.trim() || "borrador",
        creado: new Date(),
        actualizado: new Date(),
      },
      include: includeItinerarioCompleto,
    });

    return reply.code(201).send(itinerario);
  });

  app.patch("/:id_itinerario", async (request, reply) => {
    const { id_itinerario } = request.params as { id_itinerario: string };
    const itinerarioId = toInt(id_itinerario);

    if (itinerarioId === null) {
      return reply.code(400).send({ message: "id_itinerario inválido" });
    }

    const body = request.body as {
      titulo?: string;
      destino?: string;
      inicio?: string;
      fin?: string;
      presupuesto?: number;
      transporte?: string;
      accesibilidad?: string;
      estado?: string;
    };

    const itinerario = await prisma.itinerario.update({
      where: { id_itinerario: itinerarioId },
      data: {
        ...(body.titulo !== undefined ? { titulo: body.titulo.trim() || null } : {}),
        ...(body.destino !== undefined ? { destino: body.destino.trim() || null } : {}),
        ...(body.inicio !== undefined ? { inicio: toDateOrNull(body.inicio) } : {}),
        ...(body.fin !== undefined ? { fin: toDateOrNull(body.fin) } : {}),
        ...(body.presupuesto !== undefined ? { presupuesto: body.presupuesto } : {}),
        ...(body.transporte !== undefined ? { transporte: body.transporte.trim() || null } : {}),
        ...(body.accesibilidad !== undefined ? { accesibilidad: body.accesibilidad.trim() || null } : {}),
        ...(body.estado !== undefined ? { estado: body.estado.trim() || null } : {}),
        actualizado: new Date(),
      },
      include: includeItinerarioCompleto,
    });

    return itinerario;
  });


  app.post("/:id_itinerario/acciones/manual", async (request, reply) => {
    const { id_itinerario } = request.params as { id_itinerario: string };
    const itinerarioId = toInt(id_itinerario);

    if (itinerarioId === null) {
      return reply.code(400).send({ message: "id_itinerario inválido" });
    }

    const body = request.body as ManualItineraryAction;

    try {
      const resultado = await applyManualItineraryAction(itinerarioId, body);
      return reply.send({ ok: true, resultado });
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        message: error instanceof Error ? error.message : "No se pudo modificar el itinerario",
      });
    }
  });

  app.post("/:id_itinerario/regenerar-dia", async (request, reply) => {
    const { id_itinerario } = request.params as { id_itinerario: string };
    const itinerarioId = toInt(id_itinerario);

    if (itinerarioId === null) {
      return reply.code(400).send({ message: "id_itinerario inválido" });
    }

    const body = request.body as { dayNumber?: number; mensaje?: string; message?: string };
    const dayNumber = toInt(body.dayNumber);

    if (dayNumber === null || dayNumber <= 0) {
      return reply.code(400).send({ message: "dayNumber inválido" });
    }

    try {
      const itinerario = await regeneratePartialDay(
        itinerarioId,
        dayNumber,
        body.mensaje ?? body.message ?? "Regeneración parcial desde frontend",
      );

      return reply.send({
        ok: true,
        itinerario,
        resumen: resumenDiaActualizado(itinerario, dayNumber),
      });
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        message: error instanceof Error ? error.message : "No se pudo regenerar el día",
      });
    }
  });

app.delete("/:idItinerario", async (request, reply) => {
  const params = request.params as { idItinerario?: string };
  const idItinerario = Number(params.idItinerario);

  if (!Number.isInteger(idItinerario) || idItinerario <= 0) {
    return reply.code(400).send({ message: "idItinerario inválido" });
  }

  const existente = await prisma.itinerario.findUnique({
    where: { id_itinerario: idItinerario },
    select: { id_itinerario: true },
  });

  if (!existente) {
    return reply.code(404).send({ message: "Itinerario no encontrado" });
  }

  await prisma.itinerario.delete({
    where: { id_itinerario: idItinerario },
  });

  return reply.send({ ok: true });
});
}

import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import {
  requiereAutenticacion,
  validarPropiedadRecurso,
  usuarioAutenticadoId,
} from "../../hooks/auth.hook";

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

async function buscarItinerarioRelacionado(idUsuario: number, titulo?: string | null) {
  if (!titulo) return null;

  const itinerario = await prisma.itinerario.findFirst({
    where: {
      id_usuario: idUsuario,
      titulo,
    },
    orderBy: {
      creado: "desc",
    },
    select: {
      id_itinerario: true,
    },
  });

  return itinerario?.id_itinerario ?? null;
}

export default async function conversacionesRoutes(app: FastifyInstance) {
  app.get("/:id_usuario", { preHandler: [requiereAutenticacion, validarPropiedadRecurso("id_usuario")] }, async (request, reply) => {
    const { id_usuario } = request.params as { id_usuario: string };
    const idUsuario = toInt(id_usuario);

    if (idUsuario === null) {
      return reply.code(400).send({ message: "id_usuario inválido" });
    }

    const conversaciones = await prisma.conversacion.findMany({
      where: { id_usuario: idUsuario },
      orderBy: { creado: "desc" },
      include: {
        mensajes: {
          orderBy: { creado: "desc" },
          take: 1,
        },
      },
    });

    return Promise.all(
      conversaciones.map(async (conversacion) => {
        const idItinerarioRelacionado =
          conversacion.id_itinerario ??
          (await buscarItinerarioRelacionado(conversacion.id_usuario, conversacion.titulo));

        return {
          id_conversacion: conversacion.id_conversacion,
          titulo: conversacion.titulo,
          creado: conversacion.creado,
          id_usuario: conversacion.id_usuario,
          id_itinerario: conversacion.id_itinerario,
          ultimo_mensaje: conversacion.mensajes[0]?.contenido ?? null,
          id_itinerario_relacionado: idItinerarioRelacionado,
        };
      }),
    );
  });

  app.get("/detalle/:id_conversacion", { preHandler: [requiereAutenticacion] }, async (request, reply) => {
    const { id_conversacion } = request.params as { id_conversacion: string };
    const idConversacion = toInt(id_conversacion);

    if (idConversacion === null) {
      return reply.code(400).send({ message: "id_conversacion inválido" });
    }

    const conversacion = await prisma.conversacion.findUnique({
      where: { id_conversacion: idConversacion },
      include: {
        mensajes: {
          orderBy: { creado: "asc" },
        },
      },
    });

    if (!conversacion) {
      return reply.code(404).send({ message: "Conversación no encontrada" });
    }

    if (conversacion.id_usuario !== usuarioAutenticadoId(request)) {
      return reply.code(403).send({ message: "No puedes consultar una conversación de otro usuario" });
    }

    const idItinerarioRelacionado =
      conversacion.id_itinerario ??
      (await buscarItinerarioRelacionado(conversacion.id_usuario, conversacion.titulo));

    return {
      ...conversacion,
      id_itinerario_relacionado: idItinerarioRelacionado,
    };
  });

  app.post("/", { preHandler: [requiereAutenticacion] }, async (request, reply) => {
    const idUsuario = usuarioAutenticadoId(request);
    const body = request.body as {
      id_usuario?: number;
      titulo?: string;
      id_itinerario?: number | null;
    };

    if (body.id_usuario !== undefined && Number(body.id_usuario) !== idUsuario) {
      return reply.code(403).send({ message: "No puedes crear conversaciones de otro usuario" });
    }

    const idItinerario = body.id_itinerario ? toInt(body.id_itinerario) : null;

    if (body.id_itinerario && idItinerario === null) {
      return reply.code(400).send({ message: "id_itinerario inválido" });
    }

    const conversacion = await prisma.conversacion.create({
      data: {
        id_usuario: idUsuario,
        id_itinerario: idItinerario ?? undefined,
        titulo: body.titulo ?? "Nueva conversación",
        creado: new Date(),
      },
    });

    return reply.code(201).send({
      ...conversacion,
      id_itinerario_relacionado: conversacion.id_itinerario,
    });
  });

  app.delete("/:id_conversacion", { preHandler: [requiereAutenticacion] }, async (request, reply) => {
    const { id_conversacion } = request.params as { id_conversacion: string };
    const idConversacion = toInt(id_conversacion);

    if (idConversacion === null) {
      return reply.code(400).send({ message: "id_conversacion inválido" });
    }

    const existe = await prisma.conversacion.findUnique({
      where: { id_conversacion: idConversacion },
    });

    if (!existe) {
      return reply.code(404).send({ message: "Conversación no encontrada" });
    }

    if (existe.id_usuario !== usuarioAutenticadoId(request)) {
      return reply.code(403).send({ message: "No puedes eliminar una conversación de otro usuario" });
    }

    await prisma.conversacion.delete({
      where: { id_conversacion: idConversacion },
    });

    return {
      ok: true,
      message: "Conversación eliminada correctamente",
    };
  });
}

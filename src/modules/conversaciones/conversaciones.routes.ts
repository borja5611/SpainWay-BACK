import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

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
  app.get("/:id_usuario", async (request, reply) => {
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
        const idItinerarioRelacionado = await buscarItinerarioRelacionado(
          conversacion.id_usuario,
          conversacion.titulo
        );

        return {
          id_conversacion: conversacion.id_conversacion,
          titulo: conversacion.titulo,
          creado: conversacion.creado,
          id_usuario: conversacion.id_usuario,
          ultimo_mensaje: conversacion.mensajes[0]?.contenido ?? null,
          id_itinerario_relacionado: idItinerarioRelacionado,
        };
      })
    );
  });

  app.get("/detalle/:id_conversacion", async (request, reply) => {
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

    const idItinerarioRelacionado = await buscarItinerarioRelacionado(
      conversacion.id_usuario,
      conversacion.titulo
    );

    return {
      ...conversacion,
      id_itinerario_relacionado: idItinerarioRelacionado,
    };
  });

  app.post("/", async (request, reply) => {
    const body = request.body as {
      id_usuario: number;
      titulo?: string;
    };

    const usuario = await prisma.usuario.findUnique({
      where: { id_usuario: body.id_usuario },
    });

    if (!usuario) {
      return reply.code(404).send({ message: "Usuario no encontrado" });
    }

    const conversacion = await prisma.conversacion.create({
      data: {
        id_usuario: body.id_usuario,
        titulo: body.titulo ?? "Nueva conversación",
        creado: new Date(),
      },
    });

    return reply.code(201).send({
      ...conversacion,
      id_itinerario_relacionado: null,
    });
  });

  app.delete("/:id_conversacion", async (request, reply) => {
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

    await prisma.conversacion.delete({
      where: { id_conversacion: idConversacion },
    });

    return {
      ok: true,
      message: "Conversación eliminada correctamente",
    };
  });
}

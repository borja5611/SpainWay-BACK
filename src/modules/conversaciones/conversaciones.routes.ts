import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
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

    return conversaciones.map((conversacion) => ({
      id_conversacion: conversacion.id_conversacion,
      titulo: conversacion.titulo,
      creado: conversacion.creado,
      id_usuario: conversacion.id_usuario,
      ultimo_mensaje: conversacion.mensajes[0]?.contenido ?? null,
    }));
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

    return conversacion;
  });

  app.post("/", async (request, reply) => {
    const body = request.body as { id_usuario?: number; titulo?: string };
    const idUsuario = toInt(body.id_usuario);

    if (idUsuario === null) {
      return reply.code(400).send({ message: "id_usuario inválido" });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id_usuario: idUsuario },
    });

    if (!usuario) {
      return reply.code(404).send({ message: "Usuario no encontrado" });
    }

    const conversacion = await prisma.conversacion.create({
      data: {
        id_usuario: idUsuario,
        titulo: body.titulo?.trim() || "Nuevo viaje con SpainWay",
        creado: new Date(),
      },
    });

    await prisma.mensaje.create({
      data: {
        id_conversacion: conversacion.id_conversacion,
        rol: "assistant",
        contenido: "Hola, soy SpainWay. Cuéntame el destino, la zona base, los días y tus preferencias para ayudarte a preparar el viaje.",
        creado: new Date(),
      },
    });

    return reply.code(201).send(conversacion);
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

    await prisma.$transaction([
      prisma.mensaje.deleteMany({ where: { id_conversacion: idConversacion } }),
      prisma.conversacion.delete({ where: { id_conversacion: idConversacion } }),
    ]);

    return { ok: true, message: "Conversación eliminada correctamente" };
  });
}

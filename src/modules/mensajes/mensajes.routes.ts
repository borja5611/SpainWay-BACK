import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function validarRol(rol: string | undefined | null): string {
  const limpio = rol?.trim().toLowerCase();
  if (limpio === "user" || limpio === "usuario") return "user";
  if (limpio === "assistant" || limpio === "asistente") return "assistant";
  if (limpio === "system" || limpio === "sistema") return "system";
  return "user";
}

export default async function mensajesRoutes(app: FastifyInstance) {
  app.get("/:id_conversacion", async (request, reply) => {
    const { id_conversacion } = request.params as { id_conversacion: string };
    const idConversacion = toInt(id_conversacion);

    if (idConversacion === null) {
      return reply.code(400).send({ message: "id_conversacion inválido" });
    }

    const mensajes = await prisma.mensaje.findMany({
      where: { id_conversacion: idConversacion },
      orderBy: { creado: "asc" },
    });

    return mensajes;
  });

  app.post("/", async (request, reply) => {
    const body = request.body as {
      id_conversacion?: number;
      rol?: string;
      contenido?: string;
    };

    const idConversacion = toInt(body.id_conversacion);

    if (idConversacion === null) {
      return reply.code(400).send({ message: "id_conversacion inválido" });
    }

    const contenido = body.contenido?.trim();

    if (!contenido) {
      return reply.code(400).send({ message: "El contenido del mensaje es obligatorio" });
    }

    const conversacion = await prisma.conversacion.findUnique({
      where: { id_conversacion: idConversacion },
    });

    if (!conversacion) {
      return reply.code(404).send({ message: "Conversación no encontrada" });
    }

    const mensaje = await prisma.mensaje.create({
      data: {
        id_conversacion: idConversacion,
        rol: validarRol(body.rol),
        contenido,
        creado: new Date(),
      },
    });

    return reply.code(201).send(mensaje);
  });
}

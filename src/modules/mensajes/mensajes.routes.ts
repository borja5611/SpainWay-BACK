import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
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
      id_conversacion: number;
      rol: string;
      contenido: string;
    };

    const conversacion = await prisma.conversacion.findUnique({
      where: { id_conversacion: body.id_conversacion },
    });

    if (!conversacion) {
      return reply.code(404).send({ message: "Conversación no encontrada" });
    }

    const mensaje = await prisma.mensaje.create({
      data: {
        id_conversacion: body.id_conversacion,
        rol: body.rol,
        contenido: body.contenido,
        creado: new Date(),
      },
    });

    return reply.code(201).send(mensaje);
  });
}
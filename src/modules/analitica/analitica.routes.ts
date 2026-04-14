import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export default async function analiticaRoutes(app: FastifyInstance) {
  app.post("/evento", async (request, reply) => {
    const body = request.body as {
      id_usuario: number;
      nombre_evento: string;
      tipo_entidad?: string;
      id_entidad?: number;
      metadata?: string;
    };

    const usuario = await prisma.usuario.findUnique({
      where: { id_usuario: body.id_usuario },
    });

    if (!usuario) {
      return reply.code(404).send({ message: "Usuario no encontrado" });
    }

    const evento = await prisma.analisis_Evento.create({
      data: {
        id_usuario: body.id_usuario,
        nombre_evento: body.nombre_evento,
        tipo_entidad: body.tipo_entidad,
        id_entidad: body.id_entidad,
        metadata: body.metadata,
        creado: new Date(),
      },
    });

    return reply.code(201).send(evento);
  });

  app.get("/:id_usuario", async (request, reply) => {
    const { id_usuario } = request.params as { id_usuario: string };
    const idUsuario = toInt(id_usuario);

    if (idUsuario === null) {
      return reply.code(400).send({ message: "id_usuario inválido" });
    }

    const eventos = await prisma.analisis_Evento.findMany({
      where: { id_usuario: idUsuario },
      orderBy: { creado: "desc" },
    });

    return eventos;
  });
}
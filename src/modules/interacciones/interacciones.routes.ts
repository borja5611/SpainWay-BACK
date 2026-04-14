import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export default async function interaccionesRoutes(app: FastifyInstance) {
  app.post("/", async (request, reply) => {
    const body = request.body as {
      id_usuario: number;
      id_poi: number;
      tipo_accion: string;
      metadata?: string;
    };

    const usuario = await prisma.usuario.findUnique({
      where: { id_usuario: body.id_usuario },
    });

    if (!usuario) {
      return reply.code(404).send({ message: "Usuario no encontrado" });
    }

    const poi = await prisma.poi.findUnique({
      where: { id_poi: body.id_poi },
    });

    if (!poi) {
      return reply.code(404).send({ message: "POI no encontrado" });
    }

    const interaccion = await prisma.item_interaccion.create({
      data: {
        id_usuario: body.id_usuario,
        id_poi: body.id_poi,
        tipo_accion: body.tipo_accion,
        metadata: body.metadata,
        creado: new Date(),
      },
    });

    return reply.code(201).send(interaccion);
  });

  app.get("/:id_usuario", async (request, reply) => {
    const { id_usuario } = request.params as { id_usuario: string };
    const idUsuario = toInt(id_usuario);

    if (idUsuario === null) {
      return reply.code(400).send({ message: "id_usuario inválido" });
    }

    const interacciones = await prisma.item_interaccion.findMany({
      where: { id_usuario: idUsuario },
      include: {
        poi: true,
      },
      orderBy: { creado: "desc" },
    });

    return interacciones;
  });
}
import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import {
  requiereAutenticacion,
  validarPropiedadRecurso,
  usuarioAutenticadoId,
  toInt,
} from "../../hooks/auth.hook";

export default async function analiticaRoutes(app: FastifyInstance) {
  app.post("/evento", { preHandler: [requiereAutenticacion] }, async (request, reply) => {
    // El id_usuario se toma del token, nunca del cuerpo: así un usuario no puede
    // registrar eventos de analítica en nombre de otro.
    const idUsuario = usuarioAutenticadoId(request);
    const body = request.body as {
      nombre_evento: string;
      tipo_entidad?: string;
      id_entidad?: number;
      metadata?: string;
    };

    const evento = await prisma.analisis_Evento.create({
      data: {
        id_usuario: idUsuario,
        nombre_evento: body.nombre_evento,
        tipo_entidad: body.tipo_entidad,
        id_entidad: body.id_entidad,
        metadata: body.metadata,
        creado: new Date(),
      },
    });

    return reply.code(201).send(evento);
  });

  app.get(
    "/:id_usuario",
    { preHandler: [requiereAutenticacion, validarPropiedadRecurso("id_usuario")] },
    async (request, reply) => {
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
    }
  );
}
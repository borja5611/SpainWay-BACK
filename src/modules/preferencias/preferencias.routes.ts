import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

export default async function preferenciasRoutes(app: FastifyInstance) {
  app.get("/:id_usuario", async (request, reply) => {
    const { id_usuario } = request.params as { id_usuario: string };
    const idUsuario = Number(id_usuario);

    if (Number.isNaN(idUsuario)) {
      return reply.code(400).send({ message: "id de usuario inválido" });
    }

    const preferencias = await prisma.pref_usuario.findUnique({
      where: { id_usuario: idUsuario },
    });

    if (!preferencias) {
      return {
        id_usuario: idUsuario,
        presupuesto: null,
        modo_transporte: null,
        accesibilidad: null,
        con_ninos: null,
        estilo_viaje: null,
        intereses: null,
      };
    }

    return preferencias;
  });

  app.post("/", async (request, reply) => {
    const body = request.body as {
      id_usuario: number;
      presupuesto?: number | null;
      modo_transporte?: string | null;
      accesibilidad?: string | null;
      con_ninos?: boolean | null;
      estilo_viaje?: string | null;
      intereses?: string | null;
    };

    if (!body.id_usuario || Number.isNaN(Number(body.id_usuario))) {
      return reply.code(400).send({ message: "id_usuario inválido" });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id_usuario: Number(body.id_usuario) },
    });

    if (!usuario) {
      return reply.code(404).send({ message: "Usuario no encontrado" });
    }

    const existente = await prisma.pref_usuario.findUnique({
      where: { id_usuario: Number(body.id_usuario) },
    });

    if (existente) {
      return reply.code(409).send({ message: "Las preferencias ya existen para este usuario" });
    }

    const creada = await prisma.pref_usuario.create({
      data: {
        id_usuario: Number(body.id_usuario),
        presupuesto: body.presupuesto ?? null,
        modo_transporte: body.modo_transporte ?? null,
        accesibilidad: body.accesibilidad ?? null,
        con_ninos: body.con_ninos ?? null,
        estilo_viaje: body.estilo_viaje ?? null,
        intereses: body.intereses ?? null,
      },
    });

    return reply.code(201).send(creada);
  });

  app.patch("/:id_usuario", async (request, reply) => {
    const { id_usuario } = request.params as { id_usuario: string };
    const idUsuario = Number(id_usuario);

    if (Number.isNaN(idUsuario)) {
      return reply.code(400).send({ message: "id de usuario inválido" });
    }

    const body = request.body as {
      presupuesto?: number | null;
      modo_transporte?: string | null;
      accesibilidad?: string | null;
      con_ninos?: boolean | null;
      estilo_viaje?: string | null;
      intereses?: string | null;
    };

    const usuario = await prisma.usuario.findUnique({
      where: { id_usuario: idUsuario },
    });

    if (!usuario) {
      return reply.code(404).send({ message: "Usuario no encontrado" });
    }

    const existente = await prisma.pref_usuario.findUnique({
      where: { id_usuario: idUsuario },
    });

    if (!existente) {
      const creada = await prisma.pref_usuario.create({
        data: {
          id_usuario: idUsuario,
          presupuesto: body.presupuesto ?? null,
          modo_transporte: body.modo_transporte ?? null,
          accesibilidad: body.accesibilidad ?? null,
          con_ninos: body.con_ninos ?? null,
          estilo_viaje: body.estilo_viaje ?? null,
          intereses: body.intereses ?? null,
        },
      });

      return creada;
    }

    const actualizada = await prisma.pref_usuario.update({
      where: { id_usuario: idUsuario },
      data: {
        presupuesto: body.presupuesto ?? null,
        modo_transporte: body.modo_transporte ?? null,
        accesibilidad: body.accesibilidad ?? null,
        con_ninos: body.con_ninos ?? null,
        estilo_viaje: body.estilo_viaje ?? null,
        intereses: body.intereses ?? null,
      },
    });

    return actualizada;
  });
}
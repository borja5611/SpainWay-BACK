import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export default async function usuariosRoutes(app: FastifyInstance) {
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const idUsuario = toInt(id);

    if (idUsuario === null) {
      return reply.code(400).send({ message: "id inválido" });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id_usuario: idUsuario },
      select: {
        id_usuario: true,
        nombre: true,
        email: true,
        rol: true,
        creado: true,
        actualizado: true,
      },
    });

    if (!usuario) {
      return reply.code(404).send({ message: "Usuario no encontrado" });
    }

    return usuario;
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const idUsuario = toInt(id);

    if (idUsuario === null) {
      return reply.code(400).send({ message: "id inválido" });
    }

    const body = request.body as {
      nombre?: string;
      email?: string;
      rol?: string;
      contrasena?: string;
    };

    const existe = await prisma.usuario.findUnique({
      where: { id_usuario: idUsuario },
    });

    if (!existe) {
      return reply.code(404).send({ message: "Usuario no encontrado" });
    }

    const actualizado = await prisma.usuario.update({
      where: { id_usuario: idUsuario },
      data: {
        ...(body.nombre !== undefined ? { nombre: body.nombre } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.rol !== undefined ? { rol: body.rol } : {}),
        ...(body.contrasena !== undefined ? { contrasena: body.contrasena } : {}),
        actualizado: new Date(),
      },
      select: {
        id_usuario: true,
        nombre: true,
        email: true,
        rol: true,
        creado: true,
        actualizado: true,
      },
    });

    return actualizado;
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const idUsuario = toInt(id);

    if (idUsuario === null) {
      return reply.code(400).send({ message: "id inválido" });
    }

    const existe = await prisma.usuario.findUnique({
      where: { id_usuario: idUsuario },
    });

    if (!existe) {
      return reply.code(404).send({ message: "Usuario no encontrado" });
    }

    await prisma.usuario.delete({
      where: { id_usuario: idUsuario },
    });

    return {
      ok: true,
      message: "Usuario eliminado correctamente",
    };
  });
}
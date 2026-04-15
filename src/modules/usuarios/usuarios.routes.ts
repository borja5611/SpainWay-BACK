import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";

export default async function usuariosRoutes(app: FastifyInstance) {
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const idUsuario = Number(id);

    if (Number.isNaN(idUsuario)) {
      return reply.code(400).send({ message: "id de usuario inválido" });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id_usuario: idUsuario },
      select: {
        id_usuario: true,
        nombre: true,
        nombre_usuario: true,
        email: true,
        telefono: true,
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
    const idUsuario = Number(id);

    if (Number.isNaN(idUsuario)) {
      return reply.code(400).send({ message: "id de usuario inválido" });
    }

    const body = request.body as {
      nombre?: string;
      nombre_usuario?: string;
      telefono?: string | null;
      currentPassword?: string;
      newPassword?: string;
      confirmNewPassword?: string;
    };

    const usuarioActual = await prisma.usuario.findUnique({
      where: { id_usuario: idUsuario },
    });

    if (!usuarioActual) {
      return reply.code(404).send({ message: "Usuario no encontrado" });
    }

    const data: {
      nombre?: string;
      nombre_usuario?: string;
      telefono?: string | null;
      contrasena?: string;
      actualizado: Date;
    } = {
      actualizado: new Date(),
    };

    if (typeof body.nombre === "string") {
      const nombre = body.nombre.trim();
      if (!nombre) {
        return reply.code(400).send({ message: "El nombre no puede estar vacío" });
      }
      data.nombre = nombre;
    }

    if (typeof body.nombre_usuario === "string") {
      const nombreUsuario = body.nombre_usuario.trim().toLowerCase();

      if (!/^[a-zA-Z0-9._-]{3,30}$/.test(nombreUsuario)) {
        return reply.code(400).send({
          message:
            "El nombre de usuario debe tener entre 3 y 30 caracteres y solo usar letras, números, punto, guion o guion bajo",
        });
      }

      const existe = await prisma.usuario.findFirst({
        where: {
          nombre_usuario: nombreUsuario,
          NOT: { id_usuario: idUsuario },
        },
      });

      if (existe) {
        return reply.code(409).send({ message: "El nombre de usuario ya está en uso" });
      }

      data.nombre_usuario = nombreUsuario;
    }

    if (body.telefono === null) {
      data.telefono = null;
    } else if (typeof body.telefono === "string") {
      const telefono = body.telefono.trim();

      if (telefono && !/^\+\d{7,16}$/.test(telefono)) {
        return reply.code(400).send({
          message: "El teléfono debe incluir prefijo internacional y contener solo números válidos",
        });
      }

      data.telefono = telefono || null;
    }

    const quiereCambiarPassword =
      Boolean(body.currentPassword?.trim()) ||
      Boolean(body.newPassword?.trim()) ||
      Boolean(body.confirmNewPassword?.trim());

    if (quiereCambiarPassword) {
      if (!body.currentPassword?.trim()) {
        return reply.code(400).send({ message: "Debes indicar tu contraseña actual" });
      }

      if (!body.newPassword?.trim()) {
        return reply.code(400).send({ message: "Debes indicar la nueva contraseña" });
      }

      if (!body.confirmNewPassword?.trim()) {
        return reply.code(400).send({ message: "Debes confirmar la nueva contraseña" });
      }

      const coincideActual = await bcrypt.compare(
        body.currentPassword,
        usuarioActual.contrasena
      );

      if (!coincideActual) {
        return reply.code(401).send({ message: "La contraseña actual no es correcta" });
      }

      if (body.newPassword.length < 6) {
        return reply.code(400).send({
          message: "La nueva contraseña debe tener al menos 6 caracteres",
        });
      }

      if (body.newPassword !== body.confirmNewPassword) {
        return reply.code(400).send({
          message: "La nueva contraseña y la confirmación no coinciden",
        });
      }

      data.contrasena = await bcrypt.hash(body.newPassword, 10);
    }

    const actualizado = await prisma.usuario.update({
      where: { id_usuario: idUsuario },
      data,
      select: {
        id_usuario: true,
        nombre: true,
        nombre_usuario: true,
        email: true,
        telefono: true,
        rol: true,
        creado: true,
        actualizado: true,
      },
    });

    return actualizado;
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const idUsuario = Number(id);

    if (Number.isNaN(idUsuario)) {
      return reply.code(400).send({ message: "id de usuario inválido" });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id_usuario: idUsuario },
    });

    if (!usuario) {
      return reply.code(404).send({ message: "Usuario no encontrado" });
    }

    await prisma.usuario.delete({
      where: { id_usuario: idUsuario },
    });

    return { ok: true, message: "Usuario eliminado correctamente" };
  });
}
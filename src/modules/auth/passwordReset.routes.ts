import type { FastifyInstance } from "fastify";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { enviarCorreoRecuperacionPassword } from "../../servicios/emailServicio";
import { prisma } from "../../lib/prisma";

type ForgotPasswordBody = {
  email?: string;
};

type VerifyPasswordBody = {
  email?: string;
  code?: string;
};

type ResetPasswordBody = {
  email?: string;
  code?: string;
  password?: string;
};

function normalizarEmail(email?: string): string {
  return String(email ?? "").trim().toLowerCase();
}

function generarCodigo(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashCodigo(email: string, codigo: string): string {
  const secret = process.env.PASSWORD_RESET_SECRET ?? "spainway_reset_secret_dev";

  return crypto
    .createHash("sha256")
    .update(`${email}:${codigo}:${secret}`)
    .digest("hex");
}

function getExpirationDate(): Date {
  const minutos = Number(process.env.PASSWORD_RESET_MINUTES ?? 10);
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + minutos);
  return expiresAt;
}

function respuestaGenerica() {
  return {
    ok: true,
    message:
      "Si el correo está registrado en SpainWay, recibirás un código para recuperar tu contraseña.",
  };
}

export async function passwordResetRoutes(app: FastifyInstance) {
  app.post<{ Body: ForgotPasswordBody }>("/forgot", async (request, reply) => {
    const email = normalizarEmail(request.body.email);

    if (!email) {
      return reply.code(400).send({
        ok: false,
        message: "Introduce un correo válido.",
      });
    }

    const usuario = await prisma.usuario.findUnique({
      where: {
        email,
      },
      select: {
        id_usuario: true,
        nombre: true,
        email: true,
      },
    });

    /**
     * Por seguridad, aunque el usuario no exista, respondemos igual.
     * Así nadie puede usar la pantalla para descubrir correos registrados.
     */
    if (!usuario) {
      return reply.send(respuestaGenerica());
    }

    const codigo = generarCodigo();
    const tokenHash = hashCodigo(email, codigo);

    await prisma.passwordResetToken.create({
      data: {
        id_usuario: usuario.id_usuario,
        token_hash: tokenHash,
        expires_at: getExpirationDate(),
      },
    });

    try {
      await enviarCorreoRecuperacionPassword({
        to: usuario.email,
        codigo,
        nombre: usuario.nombre,
      });
    } catch (error) {
      request.log.error(error);

      return reply.code(500).send({
        ok: false,
        message:
          "No se pudo enviar el correo de recuperación en este momento. Inténtalo de nuevo en unos minutos.",
      });
    }

    return reply.send(respuestaGenerica());
  });

  app.post<{ Body: VerifyPasswordBody }>("/verify", async (request, reply) => {
    const email = normalizarEmail(request.body.email);
    const code = String(request.body.code ?? "").trim();

    if (!email || !code) {
      return reply.code(400).send({
        ok: false,
        message: "Introduce el correo y el código recibido.",
      });
    }

    const usuario = await prisma.usuario.findUnique({
      where: {
        email,
      },
      select: {
        id_usuario: true,
      },
    });

    if (!usuario) {
      return reply.code(400).send({
        ok: false,
        message: "El código no es válido o ha caducado.",
      });
    }

    const tokenHash = hashCodigo(email, code);

    const token = await prisma.passwordResetToken.findFirst({
      where: {
        id_usuario: usuario.id_usuario,
        token_hash: tokenHash,
        used_at: null,
        expires_at: {
          gt: new Date(),
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    if (!token) {
      return reply.code(400).send({
        ok: false,
        message: "El código no es válido o ha caducado.",
      });
    }

    return reply.send({
      ok: true,
      message: "Código validado correctamente.",
    });
  });

  app.post<{ Body: ResetPasswordBody }>("/reset", async (request, reply) => {
    const email = normalizarEmail(request.body.email);
    const code = String(request.body.code ?? "").trim();
    const password = String(request.body.password ?? "");

    if (!email || !code || !password) {
      return reply.code(400).send({
        ok: false,
        message: "Completa todos los campos.",
      });
    }

    if (password.length < 6) {
      return reply.code(400).send({
        ok: false,
        message: "La nueva contraseña debe tener al menos 6 caracteres.",
      });
    }

    const usuario = await prisma.usuario.findUnique({
      where: {
        email,
      },
      select: {
        id_usuario: true,
      },
    });

    if (!usuario) {
      return reply.code(400).send({
        ok: false,
        message: "El código no es válido o ha caducado.",
      });
    }

    const tokenHash = hashCodigo(email, code);

    const token = await prisma.passwordResetToken.findFirst({
      where: {
        id_usuario: usuario.id_usuario,
        token_hash: tokenHash,
        used_at: null,
        expires_at: {
          gt: new Date(),
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    if (!token) {
      return reply.code(400).send({
        ok: false,
        message: "El código no es válido o ha caducado.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.$transaction([
      prisma.usuario.update({
        where: {
          id_usuario: usuario.id_usuario,
        },
        data: {
          contrasena: passwordHash,
        },
      }),
      prisma.passwordResetToken.update({
        where: {
          id_reset_token: token.id_reset_token,
        },
        data: {
          used_at: new Date(),
        },
      }),
    ]);

    return reply.send({
      ok: true,
      message: "Contraseña actualizada correctamente.",
    });
  });
}
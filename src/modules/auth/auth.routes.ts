import { FastifyInstance } from "fastify";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { enviarCorreoRecuperacionPassword } from "../../servicios/emailServicio";

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";


const RESET_TOKEN_TTL_SECONDS = 15 * 60;

function generarCodigoReset(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizarEmail(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function hashCodigoReset(email: string, codigo: string): string {
  const secret = process.env.PASSWORD_RESET_SECRET ?? "spainway_reset_secret_dev";

  return crypto
    .createHash("sha256")
    .update(`${email}:${codigo}:${secret}`)
    .digest("hex");
}

function getResetExpirationDate(): Date {
  const minutos = Number(process.env.PASSWORD_RESET_MINUTES ?? 10);
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + minutos);
  return expiresAt;
}

function respuestaRecuperacionGenerica(email?: string) {
  return {
    ok: true,
    email,
    message:
      "Si el correo está registrado en SpainWay, recibirás un código para recuperar tu contraseña.",
  };
}

function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Faltan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET o GOOGLE_REDIRECT_URI");
  }

  return { clientId, clientSecret, redirectUri, frontendUrl };
}

function generarNombreUsuarioBase(base: string) {
  return base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 40) || "usuario";
}

async function generarNombreUsuarioUnico(base: string) {
  let candidato = generarNombreUsuarioBase(base);
  let i = 0;

  while (true) {
    const existe = await prisma.usuario.findFirst({
      where: { nombre_usuario: candidato },
    });

    if (!existe) return candidato;

    i += 1;
    candidato = `${generarNombreUsuarioBase(base)}${i}`;
  }
}

export default async function authRoutes(app: FastifyInstance) {
  app.post("/register", async (request, reply) => {
    const body = request.body as {
      nombre: string;
      nombre_usuario: string;
      email: string;
      password: string;
      telefono?: string;
    };

    if (
      !body.nombre?.trim() ||
      !body.nombre_usuario?.trim() ||
      !body.email?.trim() ||
      !body.password?.trim()
    ) {
      return reply.code(400).send({ message: "Faltan campos obligatorios" });
    }

    const email = body.email.trim().toLowerCase();
    const nombreUsuario = body.nombre_usuario.trim().toLowerCase();

    const existeEmail = await prisma.usuario.findUnique({
      where: { email },
    });

    if (existeEmail) {
      return reply.code(409).send({ message: "El email ya está registrado" });
    }

    const existeUsuario = await prisma.usuario.findFirst({
      where: { nombre_usuario: nombreUsuario },
    });

    if (existeUsuario) {
      return reply.code(409).send({ message: "El nombre de usuario ya está en uso" });
    }

    const passwordHash = await bcrypt.hash(body.password, 10);

    const usuario = await prisma.usuario.create({
      data: {
        nombre: body.nombre.trim(),
        nombre_usuario: nombreUsuario,
        email,
        contrasena: passwordHash,
        telefono: body.telefono?.trim() || null,
        rol: "user",
        creado: new Date(),
        actualizado: new Date(),
      },
    });

    const token = app.jwt.sign({
      id_usuario: usuario.id_usuario,
      email: usuario.email,
      rol: usuario.rol,
      nombre_usuario: usuario.nombre_usuario,
    });

    return reply.code(201).send({
      token,
      usuario: {
        id_usuario: usuario.id_usuario,
        nombre: usuario.nombre,
        nombre_usuario: usuario.nombre_usuario,
        email: usuario.email,
        telefono: usuario.telefono,
        rol: usuario.rol,
      },
    });
  });

  app.post("/login", async (request, reply) => {
    const body = request.body as {
      emailOrUsername: string;
      password: string;
    };

    if (!body.emailOrUsername?.trim() || !body.password?.trim()) {
      return reply.code(400).send({ message: "Faltan credenciales" });
    }

    const credential = body.emailOrUsername.trim().toLowerCase();

    const usuario = await prisma.usuario.findFirst({
      where: {
        OR: [
          { email: credential },
          { nombre_usuario: credential },
        ],
      },
    });

    if (!usuario) {
      return reply.code(401).send({ message: "Credenciales inválidas" });
    }

    const ok = await bcrypt.compare(body.password, usuario.contrasena);

    if (!ok) {
      return reply.code(401).send({ message: "Credenciales inválidas" });
    }

    const token = app.jwt.sign({
      id_usuario: usuario.id_usuario,
      email: usuario.email,
      rol: usuario.rol,
      nombre_usuario: usuario.nombre_usuario,
    });

    return {
      token,
      usuario: {
        id_usuario: usuario.id_usuario,
        nombre: usuario.nombre,
        nombre_usuario: usuario.nombre_usuario,
        email: usuario.email,
        telefono: usuario.telefono,
        rol: usuario.rol,
      },
    };
  });


  app.post("/password/forgot", async (request, reply) => {
    const body = request.body as { email?: string };
    const email = normalizarEmail(body.email);

    if (!email) {
      return reply.code(400).send({ message: "Introduce el correo de tu cuenta" });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { email },
      select: {
        id_usuario: true,
        nombre: true,
        email: true,
      },
    });

    // Respuesta genérica para no revelar si un correo existe o no.
    if (!usuario) {
      return respuestaRecuperacionGenerica(email);
    }

    const code = generarCodigoReset();
    const tokenHash = hashCodigoReset(email, code);

    await prisma.passwordResetToken.deleteMany({
      where: {
        id_usuario: usuario.id_usuario,
        used_at: null,
      },
    });

    await prisma.passwordResetToken.create({
      data: {
        id_usuario: usuario.id_usuario,
        token_hash: tokenHash,
        expires_at: getResetExpirationDate(),
      },
    });

    try {
      await enviarCorreoRecuperacionPassword({
        to: usuario.email,
        codigo: code,
        nombre: usuario.nombre,
      });
    } catch (error) {
      request.log.error(error);

      return reply.code(500).send({
        message:
          "No hemos podido enviar el código ahora mismo. Espera unos minutos y vuelve a intentarlo.",
      });
    }

    const exposeCode = process.env.RESET_PASSWORD_EXPOSE_CODE === "true";

    return {
      ...respuestaRecuperacionGenerica(email),
      ...(exposeCode ? { devCode: code } : {}),
    };
  });

  app.post("/password/verify", async (request, reply) => {
    const body = request.body as { email?: string; code?: string };
    const email = normalizarEmail(body.email);
    const code = String(body.code ?? "").trim();

    if (!email || !/^\d{6}$/.test(code)) {
      return reply.code(400).send({ message: "Introduce el correo y el código de 6 dígitos." });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { email },
      select: {
        id_usuario: true,
      },
    });

    if (!usuario) {
      return reply.code(400).send({ message: "El código no es válido o ha caducado." });
    }

    const tokenHash = hashCodigoReset(email, code);

    const resetRecord = await prisma.passwordResetToken.findFirst({
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

    if (!resetRecord) {
      return reply.code(400).send({ message: "El código no es válido o ha caducado." });
    }

    const resetToken = app.jwt.sign(
      {
        tipo: "password_reset",
        email,
        id_usuario: usuario.id_usuario,
        id_reset_token: resetRecord.id_reset_token,
      },
      { expiresIn: RESET_TOKEN_TTL_SECONDS }
    );

    return {
      ok: true,
      resetToken,
    };
  });

  app.post("/password/reset", async (request, reply) => {
    const body = request.body as { resetToken?: string; password?: string };
    const resetToken = String(body.resetToken ?? "").trim();
    const password = String(body.password ?? "");

    if (!resetToken || !password) {
      return reply.code(400).send({ message: "Faltan datos para actualizar la contraseña." });
    }

    if (password.length < 6) {
      return reply.code(400).send({ message: "La contraseña debe tener al menos 6 caracteres." });
    }

    try {
      const payload = app.jwt.verify(resetToken) as {
        tipo?: string;
        email?: string;
        id_usuario?: number;
        id_reset_token?: number;
      };

      if (
        payload.tipo !== "password_reset" ||
        !payload.email ||
        !payload.id_usuario ||
        !payload.id_reset_token
      ) {
        return reply.code(401).send({ message: "La recuperación no es válida o ha caducado." });
      }

      const resetRecord = await prisma.passwordResetToken.findFirst({
        where: {
          id_reset_token: payload.id_reset_token,
          id_usuario: payload.id_usuario,
          used_at: null,
          expires_at: {
            gt: new Date(),
          },
        },
      });

      if (!resetRecord) {
        return reply.code(401).send({ message: "La recuperación no es válida o ha caducado." });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      await prisma.$transaction([
        prisma.usuario.update({
          where: {
            id_usuario: payload.id_usuario,
          },
          data: {
            contrasena: passwordHash,
            actualizado: new Date(),
          },
        }),
        prisma.passwordResetToken.update({
          where: {
            id_reset_token: resetRecord.id_reset_token,
          },
          data: {
            used_at: new Date(),
          },
        }),
      ]);

      return {
        ok: true,
        message: "Contraseña actualizada correctamente.",
      };
    } catch (error) {
      request.log.error(error);
      return reply.code(401).send({ message: "La recuperación no es válida o ha caducado." });
    }
  });

  app.post("/logout", async () => {
    return {
      ok: true,
      message: "Logout correcto en cliente",
    };
  });

  app.get("/me", async (request, reply) => {
    try {
      await request.jwtVerify();

      const payload = request.user as { id_usuario: number };

      const usuario = await prisma.usuario.findUnique({
        where: { id_usuario: payload.id_usuario },
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
    } catch {
      return reply.code(401).send({ message: "Token inválido o ausente" });
    }
  });

  app.post("/refresh", async (request, reply) => {
    try {
      await request.jwtVerify();

      const payload = request.user as {
        id_usuario: number;
        email: string;
        rol: string;
        nombre_usuario: string | null;
      };

      const nuevoToken = app.jwt.sign({
        id_usuario: payload.id_usuario,
        email: payload.email,
        rol: payload.rol,
        nombre_usuario: payload.nombre_usuario,
      });

      return { token: nuevoToken };
    } catch {
      return reply.code(401).send({ message: "Token inválido o ausente" });
    }
  });

  app.get("/google", async (_request, reply) => {
    const { clientId, redirectUri } = getGoogleConfig();

    const url = new URL(GOOGLE_AUTH_BASE);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");

    return reply.redirect(url.toString());
  });

  app.get("/google/callback", async (request, reply) => {
    try {
      const { code } = request.query as { code?: string };
      const { clientId, clientSecret, redirectUri, frontendUrl } = getGoogleConfig();

      if (!code) {
        return reply.code(400).send({ message: "No se recibió code de Google" });
      }

      const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenResponse.ok) {
        const text = await tokenResponse.text();
        return reply.code(400).send({ message: `Error obteniendo token de Google: ${text}` });
      }

      const tokenJson = (await tokenResponse.json()) as {
        access_token: string;
      };

      const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
        },
      });

      if (!userInfoResponse.ok) {
        const text = await userInfoResponse.text();
        return reply.code(400).send({ message: `Error obteniendo perfil de Google: ${text}` });
      }

      const profile = (await userInfoResponse.json()) as {
        email: string;
        name?: string;
        given_name?: string;
      };

      const email = profile.email.toLowerCase();

      let usuario = await prisma.usuario.findUnique({
        where: { email },
      });

      if (!usuario) {
        const nombreBase = profile.name || profile.given_name || email.split("@")[0];
        const nombreUsuario = await generarNombreUsuarioUnico(email.split("@")[0]);

        usuario = await prisma.usuario.create({
          data: {
            nombre: nombreBase,
            nombre_usuario: nombreUsuario,
            email,
            contrasena: await bcrypt.hash(`google-${crypto.randomUUID()}`, 10),
            telefono: null,
            rol: "user",
            creado: new Date(),
            actualizado: new Date(),
          },
        });
      }

      const token = app.jwt.sign({
        id_usuario: usuario.id_usuario,
        email: usuario.email,
        rol: usuario.rol,
        nombre_usuario: usuario.nombre_usuario,
      });

      const redirect = new URL(`${frontendUrl}/login`);
      redirect.searchParams.set("token", token);
      redirect.searchParams.set(
        "user",
        encodeURIComponent(
          JSON.stringify({
            id_usuario: usuario.id_usuario,
            nombre: usuario.nombre,
            nombre_usuario: usuario.nombre_usuario,
            email: usuario.email,
            telefono: usuario.telefono,
            rol: usuario.rol,
          })
        )
      );

      return reply.redirect(redirect.toString());
    } catch (error) {
      console.error(error);
      return reply.code(500).send({ message: "Error en callback de Google" });
    }
  });
}
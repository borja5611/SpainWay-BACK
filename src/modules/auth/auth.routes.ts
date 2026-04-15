import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

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
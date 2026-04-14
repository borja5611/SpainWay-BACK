import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

export default async function authRoutes(app: FastifyInstance) {
  app.post("/register", async (request, reply) => {
    const body = request.body as {
      nombre: string;
      email: string;
      password: string;
    };

    const existente = await prisma.usuario.findUnique({
      where: { email: body.email },
    });

    if (existente) {
      return reply.code(409).send({ message: "El email ya está registrado" });
    }

    const usuario = await prisma.usuario.create({
      data: {
        nombre: body.nombre,
        email: body.email,
        contrasena: body.password,
        rol: "user",
        creado: new Date(),
        actualizado: new Date(),
      },
    });

    const token = app.jwt.sign({
      id_usuario: usuario.id_usuario,
      email: usuario.email,
      rol: usuario.rol,
    });

    return reply.code(201).send({
      token,
      usuario: {
        id_usuario: usuario.id_usuario,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
      },
    });
  });

  app.post("/login", async (request, reply) => {
    const body = request.body as {
      email: string;
      password: string;
    };

    const usuario = await prisma.usuario.findUnique({
      where: { email: body.email },
    });

    if (!usuario || usuario.contrasena !== body.password) {
      return reply.code(401).send({ message: "Credenciales inválidas" });
    }

    const token = app.jwt.sign({
      id_usuario: usuario.id_usuario,
      email: usuario.email,
      rol: usuario.rol,
    });

    return {
      token,
      usuario: {
        id_usuario: usuario.id_usuario,
        nombre: usuario.nombre,
        email: usuario.email,
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

      const payload = request.user as {
        id_usuario: number;
      };

      const usuario = await prisma.usuario.findUnique({
        where: { id_usuario: payload.id_usuario },
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
      };

      const nuevoToken = app.jwt.sign({
        id_usuario: payload.id_usuario,
        email: payload.email,
        rol: payload.rol,
      });

      return {
        token: nuevoToken,
      };
    } catch {
      return reply.code(401).send({ message: "Token inválido o ausente" });
    }
  });
}
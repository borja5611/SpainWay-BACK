import { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma";

type JwtUsuario = {
  id_usuario?: number;
  email?: string;
  rol?: string;
  nombre_usuario?: string;
};

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function getUsuarioIdAutenticado(request: FastifyRequest): Promise<number> {
  await request.jwtVerify();
  const user = request.user as JwtUsuario;
  const usuarioId = toInt(user.id_usuario);

  if (usuarioId === null) {
    throw new Error("Token sin usuario válido");
  }

  return usuarioId;
}

function validarUsuarioDeRuta(usuarioRuta: unknown, usuarioToken: number): boolean {
  const usuarioRutaId = toInt(usuarioRuta);
  return usuarioRutaId !== null && usuarioRutaId === usuarioToken;
}

export default async function favoritosRoutes(app: FastifyInstance) {
  app.get("/check/:id_usuario/:id_poi", async (request, reply) => {
    let usuarioTokenId: number;

    try {
      usuarioTokenId = await getUsuarioIdAutenticado(request);
    } catch {
      return reply.code(401).send({ message: "No autorizado" });
    }

    const { id_usuario, id_poi } = request.params as {
      id_usuario: string;
      id_poi: string;
    };

    if (!validarUsuarioDeRuta(id_usuario, usuarioTokenId)) {
      return reply.code(403).send({ message: "No puedes consultar favoritos de otro usuario" });
    }

    const poiId = toInt(id_poi);

    if (poiId === null) {
      return reply.code(400).send({ message: "id_poi inválido" });
    }

    const favorito = await prisma.favoritos.findFirst({
      where: {
        id_usuario: usuarioTokenId,
        id_poi: poiId,
      },
      include: {
        poi: {
          include: {
            municipio: true,
            categoria_poi: true,
          },
        },
      },
    });

    return {
      exists: !!favorito,
      favorito: favorito ?? null,
    };
  });

  app.get("/:id_usuario", {
    schema: {
      tags: ["Favoritos"],
      summary: "Listar favoritos de un usuario autenticado",
      params: {
        type: "object",
        required: ["id_usuario"],
        properties: {
          id_usuario: { type: "integer" },
        },
      },
    },
    handler: async (request, reply) => {
      let usuarioTokenId: number;

      try {
        usuarioTokenId = await getUsuarioIdAutenticado(request);
      } catch {
        return reply.code(401).send({ message: "No autorizado" });
      }

      const { id_usuario } = request.params as { id_usuario: number | string };

      if (!validarUsuarioDeRuta(id_usuario, usuarioTokenId)) {
        return reply.code(403).send({ message: "No puedes consultar favoritos de otro usuario" });
      }

      const favoritos = await prisma.favoritos.findMany({
        where: { id_usuario: usuarioTokenId },
        include: {
          poi: {
            include: {
              municipio: true,
              categoria_poi: true,
            },
          },
        },
        orderBy: { creado: "desc" },
      });

      return favoritos;
    },
  });

  app.post("/", {
    schema: {
      tags: ["Favoritos"],
      summary: "Crear un favorito para el usuario autenticado",
      body: {
        type: "object",
        required: ["id_poi"],
        properties: {
          id_usuario: { type: "integer" },
          id_poi: { type: "integer" },
        },
      },
    },
    handler: async (request, reply) => {
      let usuarioTokenId: number;

      try {
        usuarioTokenId = await getUsuarioIdAutenticado(request);
      } catch {
        return reply.code(401).send({ message: "No autorizado" });
      }

      const body = request.body as {
        id_usuario?: number;
        id_poi?: number;
      };

      const poiId = toInt(body.id_poi);

      if (poiId === null) {
        return reply.code(400).send({ message: "id_poi inválido" });
      }

      const [usuario, poi] = await Promise.all([
        prisma.usuario.findUnique({ where: { id_usuario: usuarioTokenId } }),
        prisma.poi.findUnique({ where: { id_poi: poiId } }),
      ]);

      if (!usuario) {
        return reply.code(404).send({ message: "Usuario no encontrado" });
      }

      if (!poi) {
        return reply.code(404).send({ message: "POI no encontrado" });
      }

      const favorito = await prisma.favoritos.upsert({
        where: {
          id_usuario_id_poi: {
            id_usuario: usuarioTokenId,
            id_poi: poiId,
          },
        },
        update: {},
        create: {
          id_usuario: usuarioTokenId,
          id_poi: poiId,
          creado: new Date(),
        },
        include: {
          poi: {
            include: {
              municipio: true,
              categoria_poi: true,
            },
          },
        },
      });

      return reply.code(201).send(favorito);
    },
  });

  app.post("/toggle", async (request, reply) => {
    let usuarioTokenId: number;

    try {
      usuarioTokenId = await getUsuarioIdAutenticado(request);
    } catch {
      return reply.code(401).send({ message: "No autorizado" });
    }

    const body = request.body as {
      id_usuario?: number;
      id_poi?: number;
    };

    const poiId = toInt(body.id_poi);

    if (poiId === null) {
      return reply.code(400).send({ message: "id_poi inválido" });
    }

    const existente = await prisma.favoritos.findFirst({
      where: {
        id_usuario: usuarioTokenId,
        id_poi: poiId,
      },
    });

    if (existente) {
      await prisma.favoritos.delete({
        where: { id_favoritos: existente.id_favoritos },
      });

      return reply.send({
        ok: true,
        active: false,
        message: "Favorito eliminado correctamente",
      });
    }

    const [usuario, poi] = await Promise.all([
      prisma.usuario.findUnique({ where: { id_usuario: usuarioTokenId } }),
      prisma.poi.findUnique({ where: { id_poi: poiId } }),
    ]);

    if (!usuario) {
      return reply.code(404).send({ message: "Usuario no encontrado" });
    }

    if (!poi) {
      return reply.code(404).send({ message: "POI no encontrado" });
    }

    await prisma.favoritos.create({
      data: {
        id_usuario: usuarioTokenId,
        id_poi: poiId,
        creado: new Date(),
      },
    });

    return reply.code(201).send({
      ok: true,
      active: true,
      message: "Favorito añadido correctamente",
    });
  });

  app.delete("/:id_usuario/:id_poi", {
    schema: {
      tags: ["Favoritos"],
      summary: "Eliminar un favorito del usuario autenticado",
      params: {
        type: "object",
        required: ["id_usuario", "id_poi"],
        properties: {
          id_usuario: { type: "integer" },
          id_poi: { type: "integer" },
        },
      },
    },
    handler: async (request, reply) => {
      let usuarioTokenId: number;

      try {
        usuarioTokenId = await getUsuarioIdAutenticado(request);
      } catch {
        return reply.code(401).send({ message: "No autorizado" });
      }

      const { id_usuario, id_poi } = request.params as {
        id_usuario: number | string;
        id_poi: number | string;
      };

      if (!validarUsuarioDeRuta(id_usuario, usuarioTokenId)) {
        return reply.code(403).send({ message: "No puedes eliminar favoritos de otro usuario" });
      }

      const poiId = toInt(id_poi);

      if (poiId === null) {
        return reply.code(400).send({ message: "id_poi inválido" });
      }

      const favorito = await prisma.favoritos.findFirst({
        where: {
          id_usuario: usuarioTokenId,
          id_poi: poiId,
        },
      });

      if (!favorito) {
        return reply.code(404).send({ message: "Favorito no encontrado" });
      }

      await prisma.favoritos.delete({
        where: { id_favoritos: favorito.id_favoritos },
      });

      return {
        ok: true,
        message: "Favorito eliminado correctamente",
      };
    },
  });
}

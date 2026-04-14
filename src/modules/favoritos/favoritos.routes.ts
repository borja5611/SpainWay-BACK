// src/modules/favoritos/favoritos.routes.ts
import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

export default async function favoritosRoutes(app: FastifyInstance) {
  app.get("/:id_usuario", {
    schema: {
      tags: ["Favoritos"],
      summary: "Listar favoritos de un usuario",
      params: {
        type: "object",
        required: ["id_usuario"],
        properties: {
          id_usuario: { type: "integer" },
        },
      },
    },
    handler: async (request) => {
      const { id_usuario } = request.params as { id_usuario: number };

      const favoritos = await prisma.favoritos.findMany({
        where: { id_usuario },
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
      summary: "Crear un favorito",
      body: {
        type: "object",
        required: ["id_usuario", "id_poi"],
        properties: {
          id_usuario: { type: "integer" },
          id_poi: { type: "integer" },
        },
      },
    },
    handler: async (request, reply) => {
      const body = request.body as {
        id_usuario: number;
        id_poi: number;
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

      const existente = await prisma.favoritos.findFirst({
        where: {
          id_usuario: body.id_usuario,
          id_poi: body.id_poi,
        },
      });

      if (existente) {
        return reply.code(409).send({ message: "El favorito ya existe" });
      }

      const favorito = await prisma.favoritos.create({
        data: {
          id_usuario: body.id_usuario,
          id_poi: body.id_poi,
          creado: new Date(),
        },
      });

      return reply.code(201).send(favorito);
    },
  });

  app.delete("/:id_usuario/:id_poi", {
    schema: {
      tags: ["Favoritos"],
      summary: "Eliminar un favorito",
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
      const { id_usuario, id_poi } = request.params as {
        id_usuario: number;
        id_poi: number;
      };

      const favorito = await prisma.favoritos.findFirst({
        where: {
          id_usuario,
          id_poi,
        },
      });

      if (!favorito) {
        return reply.code(404).send({
          message: "Favorito no encontrado",
        });
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
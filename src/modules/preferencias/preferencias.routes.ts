// src/modules/preferencias/preferencias.routes.ts
import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

export default async function preferenciasRoutes(app: FastifyInstance) {
  app.get("/:id_usuario", {
    schema: {
      tags: ["Preferencias"],
      summary: "Obtener preferencias de un usuario",
      params: {
        type: "object",
        required: ["id_usuario"],
        properties: {
          id_usuario: { type: "integer" },
        },
      },
    },
    handler: async (request, reply) => {
      const { id_usuario } = request.params as { id_usuario: number };

      const preferencias = await prisma.pref_usuario.findUnique({
        where: { id_usuario },
      });

      if (!preferencias) {
        return reply.code(404).send({
          message: "Preferencias no encontradas para este usuario",
        });
      }

      return preferencias;
    },
  });

  app.post("/", {
    schema: {
      tags: ["Preferencias"],
      summary: "Crear preferencias para un usuario",
      body: {
        type: "object",
        required: ["id_usuario"],
        properties: {
          id_usuario: { type: "integer" },
          presupuesto: { type: "integer" },
          modo_transporte: { type: "string" },
          accesibilidad: { type: "string" },
          con_ninos: { type: "boolean" },
          estilo_viaje: { type: "string" },
          intereses: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const body = request.body as {
        id_usuario: number;
        presupuesto?: number;
        modo_transporte?: string;
        accesibilidad?: string;
        con_ninos?: boolean;
        estilo_viaje?: string;
        intereses?: string;
      };

      const usuario = await prisma.usuario.findUnique({
        where: { id_usuario: body.id_usuario },
      });

      if (!usuario) {
        return reply.code(404).send({
          message: "Usuario no encontrado",
        });
      }

      const existente = await prisma.pref_usuario.findUnique({
        where: { id_usuario: body.id_usuario },
      });

      if (existente) {
        return reply.code(409).send({
          message: "El usuario ya tiene preferencias creadas",
        });
      }

      const preferencias = await prisma.pref_usuario.create({
        data: {
          id_usuario: body.id_usuario,
          presupuesto: body.presupuesto,
          modo_transporte: body.modo_transporte,
          accesibilidad: body.accesibilidad,
          con_ninos: body.con_ninos,
          estilo_viaje: body.estilo_viaje,
          intereses: body.intereses,
        },
      });

      return reply.code(201).send(preferencias);
    },
  });

  app.patch("/:id_usuario", {
    schema: {
      tags: ["Preferencias"],
      summary: "Actualizar preferencias de un usuario",
      params: {
        type: "object",
        required: ["id_usuario"],
        properties: {
          id_usuario: { type: "integer" },
        },
      },
      body: {
        type: "object",
        properties: {
          presupuesto: { type: "integer" },
          modo_transporte: { type: "string" },
          accesibilidad: { type: "string" },
          con_ninos: { type: "boolean" },
          estilo_viaje: { type: "string" },
          intereses: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { id_usuario } = request.params as { id_usuario: number };
      const body = request.body as {
        presupuesto?: number;
        modo_transporte?: string;
        accesibilidad?: string;
        con_ninos?: boolean;
        estilo_viaje?: string;
        intereses?: string;
      };

      const existente = await prisma.pref_usuario.findUnique({
        where: { id_usuario },
      });

      if (!existente) {
        return reply.code(404).send({
          message: "Preferencias no encontradas para este usuario",
        });
      }

      const preferencias = await prisma.pref_usuario.update({
        where: { id_usuario },
        data: {
          presupuesto: body.presupuesto,
          modo_transporte: body.modo_transporte,
          accesibilidad: body.accesibilidad,
          con_ninos: body.con_ninos,
          estilo_viaje: body.estilo_viaje,
          intereses: body.intereses,
        },
      });

      return preferencias;
    },
  });
}
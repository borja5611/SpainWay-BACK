import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export default async function programacionPoiRoutes(app: FastifyInstance) {
  app.get("/:id_poi", async (request, reply) => {
    const { id_poi } = request.params as { id_poi: string };
    const idPoi = toInt(id_poi);

    if (idPoi === null) {
      return reply.code(400).send({ message: "id_poi inválido" });
    }

    const programacion = await prisma.programacion_poi.findMany({
      where: { id_poi: idPoi },
      orderBy: [{ dia_semana: "asc" }, { inicio: "asc" }],
    });

    return programacion;
  });

  app.post("/", async (request, reply) => {
    const body = request.body as {
      id_poi: number;
      dia_semana: number;
      inicio?: string;
      fin?: string;
      cerrado?: boolean;
    };

    const poi = await prisma.poi.findUnique({
      where: { id_poi: body.id_poi },
    });

    if (!poi) {
      return reply.code(404).send({ message: "POI no encontrado" });
    }

    const item = await prisma.programacion_poi.create({
      data: {
        id_poi: body.id_poi,
        dia_semana: body.dia_semana,
        inicio: body.inicio,
        fin: body.fin,
        cerrado: body.cerrado ?? false,
      },
    });

    return reply.code(201).send(item);
  });

  app.patch("/:id_programacion", async (request, reply) => {
    const { id_programacion } = request.params as { id_programacion: string };
    const idProgramacion = toInt(id_programacion);

    if (idProgramacion === null) {
      return reply.code(400).send({ message: "id_programacion inválido" });
    }

    const body = request.body as {
      dia_semana?: number;
      inicio?: string;
      fin?: string;
      cerrado?: boolean;
    };

    const existe = await prisma.programacion_poi.findUnique({
      where: { id_programacion: idProgramacion },
    });

    if (!existe) {
      return reply.code(404).send({ message: "Programación no encontrada" });
    }

    const actualizado = await prisma.programacion_poi.update({
      where: { id_programacion: idProgramacion },
      data: {
        ...(body.dia_semana !== undefined ? { dia_semana: body.dia_semana } : {}),
        ...(body.inicio !== undefined ? { inicio: body.inicio } : {}),
        ...(body.fin !== undefined ? { fin: body.fin } : {}),
        ...(body.cerrado !== undefined ? { cerrado: body.cerrado } : {}),
      },
    });

    return actualizado;
  });

  app.delete("/:id_programacion", async (request, reply) => {
    const { id_programacion } = request.params as { id_programacion: string };
    const idProgramacion = toInt(id_programacion);

    if (idProgramacion === null) {
      return reply.code(400).send({ message: "id_programacion inválido" });
    }

    const existe = await prisma.programacion_poi.findUnique({
      where: { id_programacion: idProgramacion },
    });

    if (!existe) {
      return reply.code(404).send({ message: "Programación no encontrada" });
    }

    await prisma.programacion_poi.delete({
      where: { id_programacion: idProgramacion },
    });

    return {
      ok: true,
      message: "Programación eliminada correctamente",
    };
  });
}
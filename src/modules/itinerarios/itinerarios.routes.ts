import { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma";
import {
  applyManualItineraryAction,
  regeneratePartialDay,
  resumenDiaActualizado,
  type ManualItineraryAction,
} from "./itinerario-edicion.service";

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}


type JwtUsuario = {
  id_usuario?: number;
  email?: string;
  rol?: string;
  nombre_usuario?: string;
};

async function getUsuarioIdAutenticado(request: FastifyRequest): Promise<number> {
  await request.jwtVerify();
  const user = request.user as JwtUsuario;
  const usuarioId = toInt(user.id_usuario);

  if (usuarioId === null || usuarioId <= 0) {
    throw new Error("Token sin usuario válido");
  }

  return usuarioId;
}

function validarUsuarioDeRuta(usuarioRuta: unknown, usuarioToken: number): boolean {
  const usuarioRutaId = toInt(usuarioRuta);
  return usuarioRutaId !== null && usuarioRutaId === usuarioToken;
}

async function existeItinerarioDelUsuario(idItinerario: number, idUsuario: number) {
  return prisma.itinerario.findFirst({
    where: {
      id_itinerario: idItinerario,
      id_usuario: idUsuario,
    },
    select: { id_itinerario: true },
  });
}

function toDateOrNull(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const includeItinerarioCompleto = {
  dias: {
    orderBy: { fecha: "asc" as const },
    include: {
      elementos: {
        orderBy: { orden: "asc" as const },
        include: {
          poi: {
            include: {
              municipio: true,
              categoria_poi: true,
              destacados_ccaa: true,
            },
          },
        },
      },
      eventos: {
        include: {
          evento_turistico: true,
        },
      },
    },
  },
  eventos: {
    include: {
      evento_turistico: true,
    },
  },
};

export default async function itinerariosRoutes(app: FastifyInstance) {
  // -----------------------------------------------------------------------
  // GET /:idItinerario/auditoria
  // Traza de decisión del recomendador para un itinerario (requiere ser dueño).
  // Devuelve available:false para itinerarios antiguos sin traza.
  // -----------------------------------------------------------------------
  app.get("/:idItinerario/auditoria", async (request, reply) => {
    let usuarioId: number;
    try {
      usuarioId = await getUsuarioIdAutenticado(request);
    } catch {
      return reply.code(401).send({ ok: false, message: "No autenticado" });
    }

    const { idItinerario } = request.params as { idItinerario?: string };
    const idItin = toInt(idItinerario);
    if (idItin === null) {
      return reply.code(400).send({ ok: false, message: "idItinerario inválido" });
    }

    const itinerario = await prisma.itinerario.findFirst({
      where: { id_itinerario: idItin, id_usuario: usuarioId },
      select: { id_itinerario: true, titulo: true, destino: true, ia_json: true },
    });

    if (!itinerario) {
      return reply
        .code(404)
        .send({ ok: false, message: "Itinerario no encontrado o no te pertenece" });
    }

    const ia = (itinerario.ia_json as Record<string, unknown> | null) ?? null;
    const engine = (ia?.engine_metadata as Record<string, unknown> | undefined) ?? null;
    const trace = (ia?.decision_trace as Record<string, unknown> | undefined) ?? null;
    const available = Boolean(engine || trace);

    if (!available) {
      return reply.send({
        ok: true,
        available: false,
        id_itinerario: itinerario.id_itinerario,
        summary_message: "Resumen de criterios utilizados para construir la recomendación.",
        message:
          "Este itinerario se generó con una versión anterior y no incluye traza de auditoría.",
      });
    }

    return reply.send({
      ok: true,
      available: true,
      id_itinerario: itinerario.id_itinerario,
      engine,
      input_summary: (trace?.input_summary as unknown) ?? null,
      candidate_pipeline: (trace?.candidate_pipeline as unknown) ?? [],
      scoring_weights: (trace?.scoring_weights as unknown) ?? null,
      selected_summary: (trace?.selected_summary as unknown) ?? null,
      quality_flags: (trace?.quality_flags as unknown) ?? [],
      quality_metrics: (ia?.quality_metrics as unknown) ?? null,
      summary_message: "Resumen de criterios utilizados para construir la recomendación.",
    });
  });

  app.get("/resumen/:id_usuario", async (request, reply) => {
    let usuarioId: number;

    try {
      usuarioId = await getUsuarioIdAutenticado(request);
    } catch {
      return reply.code(401).send({ message: "No autorizado" });
    }

    const { id_usuario } = request.params as { id_usuario: string };

    if (!validarUsuarioDeRuta(id_usuario, usuarioId)) {
      return reply.code(403).send({ message: "No puedes consultar itinerarios de otro usuario" });
    }

    const itinerarios = await prisma.itinerario.findMany({
      where: { id_usuario: usuarioId },
      select: {
        id_itinerario: true,
        titulo: true,
        destino: true,
        inicio: true,
        fin: true,
        presupuesto: true,
        transporte: true,
        accesibilidad: true,
        estado: true,
        creado: true,
        actualizado: true,
        id_usuario: true,
        base_nombre: true,
        base_direccion: true,
        base_latitud: true,
        base_longitud: true,
        permite_excursiones: true,
        radio_max_km: true,
        ia_resumen: true,
        ia_json: true,
        preferencias_json: true,
        dias: {
          select: {
            id_dia_itinerario: true,
            elementos: {
              select: {
                id_elemento_itinerario: true,
              },
            },
          },
        },
      },
      orderBy: { creado: "desc" },
    });

    return itinerarios;
  });

  app.get("/detalle/:id_itinerario", async (request, reply) => {
    let usuarioId: number;

    try {
      usuarioId = await getUsuarioIdAutenticado(request);
    } catch {
      return reply.code(401).send({ message: "No autorizado" });
    }

    const { id_itinerario } = request.params as { id_itinerario: string };
    const itinerarioId = toInt(id_itinerario);

    if (itinerarioId === null) {
      return reply.code(400).send({ message: "id_itinerario inválido" });
    }

    const itinerario = await prisma.itinerario.findFirst({
      where: {
        id_itinerario: itinerarioId,
        id_usuario: usuarioId,
      },
      include: includeItinerarioCompleto,
    });

    if (!itinerario) {
      return reply.code(404).send({ message: "Itinerario no encontrado" });
    }

    return itinerario;
  });

  // ─── Helpers locales para el endpoint de mapa ───────────────────────────────
  function toIsoOrNull(value: Date | string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  function toFiniteNumber(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  app.get("/mapa/:id_usuario", async (request, reply) => {
    let usuarioId: number;

    try {
      usuarioId = await getUsuarioIdAutenticado(request);
    } catch {
      return reply.code(401).send({ message: "No autorizado" });
    }

    const { id_usuario } = request.params as { id_usuario: string };

    if (!validarUsuarioDeRuta(id_usuario, usuarioId)) {
      return reply.code(403).send({ message: "No puedes consultar itinerarios de otro usuario" });
    }

    try {
      const itinerarios = await prisma.itinerario.findMany({
        where: { id_usuario: usuarioId },
        select: {
          id_itinerario: true,
          titulo: true,
          destino: true,
          inicio: true,
          fin: true,
          creado: true,
          dias: {
            orderBy: { fecha: "asc" as const },
            select: {
              id_dia_itinerario: true,
              fecha: true,
              elementos: {
                orderBy: { orden: "asc" as const },
                select: {
                  id_elemento_itinerario: true,
                  orden: true,
                  inicio: true,
                  fin: true,
                  poi: {
                    select: {
                      id_poi: true,
                      nombre: true,
                      tipo: true,
                      subcategoria: true,
                      direccion: true,
                      latitud: true,
                      longitud: true,
                      descripcion: true,
                      google_search_url: true,
                      categoria_poi: {
                        select: { id_categoria_poi: true, nombre: true },
                      },
                      municipio: {
                        select: { id_municipio: true, nombre: true },
                      },
                      destacados_ccaa: {
                        select: { imagen_url: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { creado: "desc" },
      });

      const resultado = itinerarios.map((it, _i) => ({
        id_itinerario: it.id_itinerario,
        titulo: it.titulo ?? null,
        destino: it.destino ?? null,
        inicio: toIsoOrNull(it.inicio),
        fin: toIsoOrNull(it.fin),
        dias: it.dias.map((dia, diaIndex) => ({
          id_dia_itinerario: dia.id_dia_itinerario,
          numero_dia: diaIndex + 1,
          fecha: toIsoOrNull(dia.fecha),
          pois: dia.elementos
            .filter((el) => {
              if (!el.poi) return false;
              const lat = toFiniteNumber(el.poi.latitud);
              const lng = toFiniteNumber(el.poi.longitud);
              return lat !== null && lng !== null;
            })
            .map((el) => {
              const poi = el.poi!;
              const lat = toFiniteNumber(poi.latitud)!;
              const lng = toFiniteNumber(poi.longitud)!;
              const categoria =
                (poi.categoria_poi as { nombre?: string } | null)?.nombre ??
                poi.tipo ??
                poi.subcategoria ??
                "Lugar de interés";
              const imagen_url =
                (poi.destacados_ccaa as { imagen_url?: string | null }[])
                  ?.find((d) => d.imagen_url)?.imagen_url ?? null;
              return {
                id_poi: poi.id_poi,
                nombre: poi.nombre,
                categoria,
                descripcion: poi.descripcion ?? null,
                direccion: poi.direccion ?? null,
                latitud: lat,
                longitud: lng,
                orden: el.orden ?? null,
                inicio: toIsoOrNull(el.inicio),
                fin: toIsoOrNull(el.fin),
                google_search_url: poi.google_search_url ?? null,
                imagen_url,
                municipio: poi.municipio
                  ? {
                      id_municipio: (poi.municipio as { id_municipio: number; nombre: string }).id_municipio,
                      nombre: (poi.municipio as { id_municipio: number; nombre: string }).nombre,
                    }
                  : null,
              };
            }),
        })),
      }));

      return reply.send(resultado);
    } catch (error) {
      console.error("Error cargando itinerarios para mapa:", error);
      return reply.code(500).send({ message: "No se pudieron cargar los itinerarios para el mapa" });
    }
  });

  app.get("/:id_usuario", async (request, reply) => {
    let usuarioId: number;

    try {
      usuarioId = await getUsuarioIdAutenticado(request);
    } catch {
      return reply.code(401).send({ message: "No autorizado" });
    }

    const { id_usuario } = request.params as { id_usuario: string };

    if (!validarUsuarioDeRuta(id_usuario, usuarioId)) {
      return reply.code(403).send({ message: "No puedes consultar itinerarios de otro usuario" });
    }

    const itinerarios = await prisma.itinerario.findMany({
      where: { id_usuario: usuarioId },
      include: includeItinerarioCompleto,
      orderBy: { creado: "desc" },
    });

    return itinerarios;
  });

  app.post("/", async (request, reply) => {
    let usuarioId: number;

    try {
      usuarioId = await getUsuarioIdAutenticado(request);
    } catch {
      return reply.code(401).send({ message: "No autorizado" });
    }

    const body = request.body as {
      id_usuario?: number;
      titulo?: string;
      destino?: string;
      inicio?: string;
      fin?: string;
      presupuesto?: number;
      transporte?: string;
      accesibilidad?: string;
      estado?: string;
    };

    const usuario = await prisma.usuario.findUnique({ where: { id_usuario: usuarioId } });
    if (!usuario) {
      return reply.code(404).send({ message: "Usuario no encontrado" });
    }

    const itinerario = await prisma.itinerario.create({
      data: {
        id_usuario: usuarioId,
        titulo: body.titulo?.trim() || "Nuevo itinerario",
        destino: body.destino?.trim() || null,
        inicio: toDateOrNull(body.inicio),
        fin: toDateOrNull(body.fin),
        presupuesto: body.presupuesto ?? null,
        transporte: body.transporte?.trim() || null,
        accesibilidad: body.accesibilidad?.trim() || null,
        estado: body.estado?.trim() || "borrador",
        creado: new Date(),
        actualizado: new Date(),
      },
      include: includeItinerarioCompleto,
    });

    return reply.code(201).send(itinerario);
  });

  app.patch("/:id_itinerario", async (request, reply) => {
    let usuarioId: number;

    try {
      usuarioId = await getUsuarioIdAutenticado(request);
    } catch {
      return reply.code(401).send({ message: "No autorizado" });
    }

    const { id_itinerario } = request.params as { id_itinerario: string };
    const itinerarioId = toInt(id_itinerario);

    if (itinerarioId === null) {
      return reply.code(400).send({ message: "id_itinerario inválido" });
    }

    const pertenece = await existeItinerarioDelUsuario(itinerarioId, usuarioId);
    if (!pertenece) {
      return reply.code(404).send({ message: "Itinerario no encontrado" });
    }

    const body = request.body as {
      titulo?: string;
      destino?: string;
      inicio?: string;
      fin?: string;
      presupuesto?: number;
      transporte?: string;
      accesibilidad?: string;
      estado?: string;
    };

    const itinerario = await prisma.itinerario.update({
      where: { id_itinerario: itinerarioId },
      data: {
        ...(body.titulo !== undefined ? { titulo: body.titulo.trim() || null } : {}),
        ...(body.destino !== undefined ? { destino: body.destino.trim() || null } : {}),
        ...(body.inicio !== undefined ? { inicio: toDateOrNull(body.inicio) } : {}),
        ...(body.fin !== undefined ? { fin: toDateOrNull(body.fin) } : {}),
        ...(body.presupuesto !== undefined ? { presupuesto: body.presupuesto } : {}),
        ...(body.transporte !== undefined ? { transporte: body.transporte.trim() || null } : {}),
        ...(body.accesibilidad !== undefined ? { accesibilidad: body.accesibilidad.trim() || null } : {}),
        ...(body.estado !== undefined ? { estado: body.estado.trim() || null } : {}),
        actualizado: new Date(),
      },
      include: includeItinerarioCompleto,
    });

    return itinerario;
  });


  app.post("/:id_itinerario/acciones/manual", async (request, reply) => {
    const { id_itinerario } = request.params as { id_itinerario: string };
    const itinerarioId = toInt(id_itinerario);

    if (itinerarioId === null) {
      return reply.code(400).send({ message: "id_itinerario inválido" });
    }

    let usuarioId: number;
    try {
      usuarioId = await getUsuarioIdAutenticado(request);
    } catch {
      return reply.code(401).send({ message: "No autorizado" });
    }

    const pertenece = await existeItinerarioDelUsuario(itinerarioId, usuarioId);
    if (!pertenece) {
      return reply.code(404).send({ message: "Itinerario no encontrado" });
    }

    const body = request.body as ManualItineraryAction;

    try {
      const resultado = await applyManualItineraryAction(itinerarioId, body);
      return reply.send({ ok: true, resultado });
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        message: error instanceof Error ? error.message : "No se pudo modificar el itinerario",
      });
    }
  });

  app.post("/:id_itinerario/regenerar-dia", async (request, reply) => {
    let usuarioId: number;

    try {
      usuarioId = await getUsuarioIdAutenticado(request);
    } catch {
      return reply.code(401).send({ message: "No autorizado" });
    }

    const { id_itinerario } = request.params as { id_itinerario: string };
    const itinerarioId = toInt(id_itinerario);

    if (itinerarioId === null) {
      return reply.code(400).send({ message: "id_itinerario inválido" });
    }

    const pertenece = await existeItinerarioDelUsuario(itinerarioId, usuarioId);
    if (!pertenece) {
      return reply.code(404).send({ message: "Itinerario no encontrado" });
    }

    const body = request.body as { dayNumber?: number; mensaje?: string; message?: string };
    const dayNumber = toInt(body.dayNumber);

    if (dayNumber === null || dayNumber <= 0) {
      return reply.code(400).send({ message: "dayNumber inválido" });
    }

    try {
      const itinerario = await regeneratePartialDay(
        itinerarioId,
        dayNumber,
        body.mensaje ?? body.message ?? "Regeneración parcial desde frontend",
      );

      return reply.send({
        ok: true,
        itinerario,
        resumen: resumenDiaActualizado(itinerario, dayNumber),
      });
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        message: error instanceof Error ? error.message : "No se pudo regenerar el día",
      });
    }
  });

app.delete("/:idItinerario", async (request, reply) => {
  let usuarioId: number;

  try {
    usuarioId = await getUsuarioIdAutenticado(request);
  } catch {
    return reply.code(401).send({ message: "No autorizado" });
  }

  const params = request.params as { idItinerario?: string };
  const idItinerario = Number(params.idItinerario);

  if (!Number.isInteger(idItinerario) || idItinerario <= 0) {
    return reply.code(400).send({ message: "idItinerario inválido" });
  }

  const existente = await existeItinerarioDelUsuario(idItinerario, usuarioId);

  if (!existente) {
    return reply.code(404).send({ message: "Itinerario no encontrado" });
  }

  await prisma.itinerario.delete({
    where: { id_itinerario: idItinerario },
  });

  return reply.send({ ok: true });
});
}

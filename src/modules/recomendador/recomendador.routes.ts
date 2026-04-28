import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

type PayloadRecomendador = {
  id_usuario?: number;
  destination?: string;
  days?: number;
  budget?: string;
  dates?: string[];
  pace?: string;
  trip_type?: string;
  companions?: string;
  transport?: string;
  must_see?: string;
  extras?: string;
  notes?: string;
  base_location_name?: string;
  base_address?: string;
  base_place_id?: string;
  base_lat?: number | null;
  base_lon?: number | null;
  allow_excursions?: boolean;
  max_distance_km?: number | null;
  visited_global_ids?: string[];
  visited_poi_names?: string[];
  negative_preferences?: string[];
};

type IaPoi = {
  global_id?: string;
  id_global?: string;
  name?: string;
  nombre?: string;
  reason?: string;
  motivo?: string;
  image_url?: string;
  imagen_url?: string;
  google_search_url?: string;
};

type IaDayPlan = {
  day_number?: number;
  dia?: number;
  theme?: string;
  titulo?: string;
  total_minutes?: number | null;
  minutos?: number | null;
  pois?: IaPoi[];
  items?: IaPoi[];
  local_tips?: string[];
  consejos?: string[];
};

type IaResponse = {
  destination?: string;
  days?: number;
  anchors_used?: string[];
  summary?: string;
  resumen?: string;
  items?: IaPoi[];
  day_plans?: IaDayPlan[];
  dias?: IaDayPlan[];
  [key: string]: unknown;
};

type DiaNormalizado = {
  day_number: number;
  theme: string;
  total_minutes: number | null;
  pois: IaPoi[];
  local_tips: string[];
};

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function normalizarTextoBusqueda(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolverVisitedGlobalIds(
  visitedGlobalIds: string[],
  visitedPoiNames?: string[],
): Promise<string[]> {
  const ids = new Set<string>(
    visitedGlobalIds.map((id) => id.trim()).filter(Boolean),
  );
  const nombres = (visitedPoiNames ?? [])
    .map((name) => name.trim())
    .filter(Boolean);

  if (nombres.length === 0) return [...ids];

  const candidatos = await prisma.poi.findMany({
    where: {
      OR: nombres.map((name) => ({
        nombre: { contains: name, mode: "insensitive" },
      })),
    },
    select: { id_global: true, nombre: true },
    take: 200,
  });

  const nombresNormalizados = nombres.map(normalizarTextoBusqueda);

  for (const poi of candidatos) {
    const nombrePoi = normalizarTextoBusqueda(poi.nombre ?? "");
    const coincide = nombresNormalizados.some((name) => {
      if (!name || !nombrePoi) return false;
      return nombrePoi.includes(name) || name.includes(nombrePoi);
    });

    if (coincide && poi.id_global) ids.add(poi.id_global);
  }

  return [...ids];
}

function extraerNombresDesdePreferenciasNegativas(values?: string[]): string[] {
  return (values ?? [])
    .flatMap((item) => item.split(/[\n,;]+/))
    .map((item) =>
      item
        .replace(/^no quiero\s+/i, "")
        .replace(/^evitar\s+/i, "")
        .replace(/^sin\s+/i, "")
        .trim(),
    )
    .filter(Boolean)
    .filter((item) => item.length >= 3);
}

function filtrarPoisExcluidos(
  dayPlans: DiaNormalizado[],
  excludedGlobalIds: string[],
  excludedNames: string[],
): DiaNormalizado[] {
  const excludedIds = new Set(
    excludedGlobalIds.map((id) => id.trim()).filter(Boolean),
  );
  const excludedNamesNorm = excludedNames
    .map(normalizarTextoBusqueda)
    .filter(Boolean);

  return dayPlans.map((day) => ({
    ...day,
    pois: day.pois.filter((poi) => {
      const globalId = getPoiGlobalId(poi);
      const nombre = normalizarTextoBusqueda(getPoiName(poi));

      if (globalId && excludedIds.has(globalId)) return false;

      const coincideNombre = excludedNamesNorm.some(
        (name) => nombre.includes(name) || name.includes(nombre),
      );

      return !coincideNombre;
    }),
  }));
}

function distanciaKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const radioTierraKm = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radioTierraKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function categoriaTextoPoi(poi: {
  tipo?: string | null;
  subcategoria?: string | null;
  categoria_poi?: { nombre?: string | null; slug?: string | null } | null;
}): string {
  return poi.categoria_poi?.slug || poi.categoria_poi?.nombre || poi.subcategoria || poi.tipo || "poi";
}

function inferirTemaPorDia(dayNumber: number, destination: string, pois: IaPoi[]) {
  const texto = pois
    .map((poi) => normalizarTextoBusqueda(`${poi.motivo ?? ""} ${poi.reason ?? ""} ${getPoiName(poi)}`))
    .join(" ");

  if (texto.includes("parque") || texto.includes("naturaleza")) return `${destination} · naturaleza y paseo`;
  if (texto.includes("playa") || texto.includes("costa")) return `${destination} · costa y ambiente local`;
  if (texto.includes("mercado") || texto.includes("gastronomia")) return `${destination} · gastronomía y barrios`;
  if (dayNumber % 3 === 0) return `${destination} · barrios y descubrimiento`;
  if (dayNumber % 2 === 0) return `${destination} · cultura y patrimonio`;
  return `${destination} · imprescindibles cercanos`;
}

async function buscarPoisComplementariosDesdeBbdd(
  payload: PayloadRecomendador,
  excludedGlobalIds: string[],
  excludedNames: string[],
  alreadySelected: DiaNormalizado[],
): Promise<IaPoi[]> {
  const baseLat = Number(payload.base_lat);
  const baseLon = Number(payload.base_lon);
  const destination = payload.destination ?? "";
  const tripType = normalizarTextoBusqueda(payload.trip_type ?? "");
  const mustSee = normalizarTextoBusqueda(payload.must_see ?? "");
  const extras = normalizarTextoBusqueda(payload.extras ?? "");
  const negative = normalizarTextoBusqueda((payload.negative_preferences ?? []).join(" "));
  const preferencias = `${tripType} ${mustSee} ${extras}`;
  const destinationNorm = normalizarTextoBusqueda(destination);

  const excludedIds = new Set(excludedGlobalIds.map((id) => id.trim()).filter(Boolean));
  const excludedNamesNorm = excludedNames.map(normalizarTextoBusqueda).filter(Boolean);
  const alreadyIds = new Set<string>();
  const alreadyNames = new Set<string>();

  for (const day of alreadySelected) {
    for (const poi of day.pois) {
      const id = getPoiGlobalId(poi);
      const name = normalizarTextoBusqueda(getPoiName(poi));
      if (id) alreadyIds.add(id);
      if (name) alreadyNames.add(name);
    }
  }

  const candidatos = await prisma.poi.findMany({
    where: {
      valido: true,
      OR: [
        { nombre: { contains: destination, mode: "insensitive" } },
        { direccion: { contains: destination, mode: "insensitive" } },
        { municipio: { nombre: { contains: destination, mode: "insensitive" } } },
      ],
    },
    select: {
      id_global: true,
      nombre: true,
      tipo: true,
      subcategoria: true,
      direccion: true,
      latitud: true,
      longitud: true,
      popularidad: true,
      puntuacion: true,
      categoria_poi: { select: { nombre: true, slug: true } },
    },
    take: 1000,
  });

  const filtrados = candidatos
    .map((poi) => {
      const lat = Number(poi.latitud);
      const lon = Number(poi.longitud);
      const globalId = poi.id_global ?? "";
      const nombre = poi.nombre ?? "POI";
      const nombreNorm = normalizarTextoBusqueda(nombre);
      const categoria = categoriaTextoPoi(poi);
      const categoriaNorm = normalizarTextoBusqueda(categoria);
      const direccionNorm = normalizarTextoBusqueda(poi.direccion ?? "");

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      if (globalId && excludedIds.has(globalId)) return null;
      if (globalId && alreadyIds.has(globalId)) return null;
      if (alreadyNames.has(nombreNorm)) return null;
      if (excludedNamesNorm.some((name) => nombreNorm.includes(name) || name.includes(nombreNorm))) return null;

      if (negative.includes("playa") && categoriaNorm.includes("playa")) return null;
      if (negative.includes("museo") && (nombreNorm.includes("museo") || categoriaNorm.includes("cultura"))) return null;

      const dist = distanciaKm(baseLat, baseLon, lat, lon);
      const categoriaPreferida =
        (preferencias.includes("cultural") && (categoriaNorm.includes("cultura") || categoriaNorm.includes("patrimonio") || nombreNorm.includes("museo"))) ||
        (preferencias.includes("naturaleza") && (categoriaNorm.includes("naturaleza") || nombreNorm.includes("parque"))) ||
        (preferencias.includes("gastronomia") && (categoriaNorm.includes("gastronomia") || nombreNorm.includes("mercado"))) ||
        (preferencias.includes("costa") && categoriaNorm.includes("playa")) ||
        (mustSee.length > 2 && (mustSee.includes(nombreNorm) || nombreNorm.includes(mustSee)));

      const scoreDistancia = Math.max(0, 90 - dist * 8);
      const scoreCategoria = categoriaPreferida ? 40 : 0;
      const scorePopularidad = Number(poi.popularidad ?? 0) * 0.8;
      const scorePuntuacion = Number(poi.puntuacion ?? 0) * 8;
      const scoreDireccion = destinationNorm && direccionNorm.includes(destinationNorm) ? 10 : 0;

      return { poi, score: scoreDistancia + scoreCategoria + scorePopularidad + scorePuntuacion + scoreDireccion, dist, categoria };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.score - a.score);

  return filtrados.map((item) => {
    const distText = item.dist <= 1.2 ? "muy cerca" : item.dist <= 5 ? "cerca" : "a distancia razonable";
    return {
      global_id: item.poi.id_global ?? undefined,
      name: item.poi.nombre ?? "POI",
      reason: `Seleccionado desde la base completa de POIs, ${distText} de tu zona base, categoría ${item.categoria}.`,
    };
  });
}

async function completarDiasConBbdd(
  ia: IaResponse,
  dayPlans: DiaNormalizado[],
  payload: PayloadRecomendador,
  excludedGlobalIds: string[],
  excludedNames: string[],
): Promise<DiaNormalizado[]> {
  const days = Number(payload.days ?? 1);
  const destination = payload.destination ?? "destino";
  const complementarios = await buscarPoisComplementariosDesdeBbdd(payload, excludedGlobalIds, excludedNames, dayPlans);

  const excludedIds = new Set(excludedGlobalIds.map((id) => id.trim()).filter(Boolean));
  const excludedNamesNorm = excludedNames.map(normalizarTextoBusqueda).filter(Boolean);
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();

  const pool = [...dayPlans.flatMap((day) => day.pois), ...(Array.isArray(ia.items) ? ia.items : []), ...complementarios].filter((poi) => {
    const globalId = getPoiGlobalId(poi);
    const nombre = normalizarTextoBusqueda(getPoiName(poi));
    if (globalId && excludedIds.has(globalId)) return false;
    return !excludedNamesNorm.some((name) => nombre.includes(name) || name.includes(nombre));
  });

  function takeNextPoi(): IaPoi | null {
    for (const poi of pool) {
      const globalId = getPoiGlobalId(poi);
      const nombre = normalizarTextoBusqueda(getPoiName(poi));
      if (globalId && usedIds.has(globalId)) continue;
      if (!globalId && usedNames.has(nombre)) continue;
      if (globalId) usedIds.add(globalId);
      if (nombre) usedNames.add(nombre);
      return poi;
    }
    return null;
  }

  const result: DiaNormalizado[] = [];
  const minPoisPorDia = payload.pace?.toLowerCase().includes("relaj") ? 2 : 3;

  for (let index = 0; index < days; index += 1) {
    const original = dayPlans[index];
    const pois: IaPoi[] = [];

    for (const poi of original?.pois ?? []) {
      const globalId = getPoiGlobalId(poi);
      const nombre = normalizarTextoBusqueda(getPoiName(poi));
      if (globalId && usedIds.has(globalId)) continue;
      if (!globalId && usedNames.has(nombre)) continue;
      if (globalId) usedIds.add(globalId);
      if (nombre) usedNames.add(nombre);
      pois.push(poi);
    }

    while (pois.length < minPoisPorDia) {
      const poi = takeNextPoi();
      if (!poi) break;
      pois.push(poi);
    }

    result.push({
      day_number: index + 1,
      theme: original?.theme ?? inferirTemaPorDia(index + 1, destination, pois),
      total_minutes: original?.total_minutes ?? (pois.length > 0 ? pois.length * 80 : 0),
      pois,
      local_tips:
        original?.local_tips && original.local_tips.length > 0
          ? original.local_tips
          : pois.length > 0
            ? ["Día completado con POIs de la base completa, evitando repeticiones y exclusiones del usuario."]
            : ["No se encontraron suficientes POIs compatibles para completar este día."],
    });
  }

  return result;
}

function presupuestoToInt(value?: string): number | null {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  if (v === "bajo") return 1;
  if (v === "medio") return 2;
  if (v === "alto") return 3;
  return null;
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizarDia(day: IaDayPlan, index: number): DiaNormalizado {
  const pois = Array.isArray(day.pois)
    ? day.pois
    : Array.isArray(day.items)
      ? day.items
      : [];

  const tips = Array.isArray(day.local_tips)
    ? day.local_tips
    : Array.isArray(day.consejos)
      ? day.consejos
      : [];

  return {
    day_number: day.day_number ?? day.dia ?? index + 1,
    theme: day.theme ?? day.titulo ?? `Día ${index + 1}`,
    total_minutes: day.total_minutes ?? day.minutos ?? null,
    pois,
    local_tips: tips,
  };
}

function getDayPlans(ia: IaResponse): DiaNormalizado[] {
  const raw = Array.isArray(ia.day_plans)
    ? ia.day_plans
    : Array.isArray(ia.dias)
      ? ia.dias
      : [];

  return raw.map(normalizarDia);
}

function getPoiGlobalId(poi: IaPoi): string | null {
  return poi.global_id ?? poi.id_global ?? null;
}

function getPoiName(poi: IaPoi): string {
  return poi.name ?? poi.nombre ?? poi.global_id ?? poi.id_global ?? "POI";
}

function getPoiReason(poi: IaPoi): string | null {
  return poi.reason ?? poi.motivo ?? null;
}

async function llamarModeloIa(
  payload: PayloadRecomendador,
): Promise<IaResponse> {
  const baseUrl = process.env.RECOMMENDER_API_URL || "http://127.0.0.1:8000";

  const response = await fetch(`${baseUrl}/recommend/itinerary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`IA ${response.status}: ${text}`);
  }

  return response.json() as Promise<IaResponse>;
}

function mensajeUsuario(payload: PayloadRecomendador) {
  return [
    `Quiero generar un itinerario para ${payload.destination}.`,
    `Días: ${payload.days}.`,
    `Fechas: ${(payload.dates ?? []).join(" → ") || "sin fechas"}.`,
    `Base: ${payload.base_location_name || payload.base_address} (${payload.base_lat}, ${payload.base_lon}).`,
    `Presupuesto: ${payload.budget}. Ritmo: ${payload.pace}. Tipo: ${payload.trip_type}.`,
    `Transporte: ${payload.transport}. Compañía: ${payload.companions || "no indicada"}.`,
    `Imprescindibles: ${payload.must_see || "ninguno"}.`,
    `Extras: ${payload.extras || "ninguno"}.`,
    `Notas: ${payload.notes || "ninguna"}.`,
    `Preferencias negativas: ${(payload.negative_preferences ?? []).join(", ") || "ninguna"}.`,
  ].join("\n");
}

function mensajeAsistente(ia: IaResponse) {
  const dayPlans = getDayPlans(ia);
  const resumen =
    ia.summary ??
    ia.resumen ??
    "Itinerario generado correctamente por el recomendador.";
  const anchors =
    Array.isArray(ia.anchors_used) && ia.anchors_used.length > 0
      ? ia.anchors_used.join(", ")
      : "ninguna";

  const dias = dayPlans
    .map((day) => {
      const pois = day.pois
        .map((poi) => {
          const reason = getPoiReason(poi);
          return `- ${getPoiName(poi)}${reason ? `: ${reason}` : ""}`;
        })
        .join("\n");

      const tips =
        day.local_tips.length > 0
          ? `\nConsejos: ${day.local_tips.join(" | ")}`
          : "";
      return `Día ${day.day_number} · ${day.theme}\n${pois || "Sin POIs asignados."}${tips}`;
    })
    .join("\n\n");

  return [resumen, "", `Anclas usadas: ${anchors}.`, "", dias]
    .filter(Boolean)
    .join("\n");
}

function crearJsonPersistente(ia: IaResponse, dayPlans: DiaNormalizado[]) {
  return {
    ...ia,
    day_plans: dayPlans,
    generated_at: new Date().toISOString(),
  };
}

export default async function recomendadorRoutes(app: FastifyInstance) {
  app.post("/generar", async (request, reply) => {
    const body = request.body as PayloadRecomendador;
    const idUsuario = toInt(body.id_usuario ?? 1);

    if (idUsuario === null) {
      return reply.code(400).send({ message: "id_usuario inválido" });
    }

    const destination = body.destination?.trim();
    if (!destination) {
      return reply.code(400).send({ message: "destination es obligatorio" });
    }

    const days = toInt(body.days);
    if (days === null || days < 1 || days > 14) {
      return reply.code(400).send({ message: "days debe estar entre 1 y 14" });
    }

    if (body.base_lat === null || body.base_lat === undefined) {
      return reply.code(400).send({ message: "base_lat es obligatorio" });
    }

    if (body.base_lon === null || body.base_lon === undefined) {
      return reply.code(400).send({ message: "base_lon es obligatorio" });
    }

    const negativePreferences = Array.isArray(body.negative_preferences)
      ? body.negative_preferences
      : [];
    const nombresExcluidosPorTexto = [
      ...(Array.isArray(body.visited_poi_names) ? body.visited_poi_names : []),
      ...extraerNombresDesdePreferenciasNegativas(negativePreferences),
    ];

    const visitedGlobalIdsFinales = await resolverVisitedGlobalIds(
      Array.isArray(body.visited_global_ids) ? body.visited_global_ids : [],
      nombresExcluidosPorTexto,
    );

    const payload: PayloadRecomendador = {
      id_usuario: idUsuario,
      destination,
      days,
      budget: body.budget || "medio",
      dates: Array.isArray(body.dates) ? body.dates : [],
      pace: body.pace || "equilibrado",
      trip_type: body.trip_type || "mixto",
      companions: body.companions || "",
      transport: body.transport || "mixto",
      must_see: body.must_see || "",
      extras: body.extras || "",
      notes: body.notes || "",
      base_location_name: body.base_location_name || body.base_address || "",
      base_address: body.base_address || body.base_location_name || "",
      base_place_id: body.base_place_id,
      base_lat: Number(body.base_lat),
      base_lon: Number(body.base_lon),
      allow_excursions: Boolean(body.allow_excursions),
      max_distance_km: body.max_distance_km ?? null,
      visited_global_ids: visitedGlobalIdsFinales,
      visited_poi_names: Array.isArray(body.visited_poi_names)
        ? body.visited_poi_names
        : [],
      negative_preferences: negativePreferences,
    };

    let ia: IaResponse;
    try {
      ia = await llamarModeloIa(payload);
    } catch (error) {
      request.log.error(error);
      return reply.code(502).send({
        ok: false,
        message:
          "No se pudo conectar con el modelo IA. Revisa Spainway-IA en http://127.0.0.1:8000.",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const dayPlansIniciales = getDayPlans(ia);
    const dayPlansFiltrados = filtrarPoisExcluidos(
      dayPlansIniciales,
      visitedGlobalIdsFinales,
      nombresExcluidosPorTexto,
    );
    const dayPlans = await completarDiasConBbdd(
      ia,
      dayPlansFiltrados,
      payload,
      visitedGlobalIdsFinales,
      nombresExcluidosPorTexto,
    );
    const iaPersistente = crearJsonPersistente(ia, dayPlans);
    const resumenAsistente = mensajeAsistente(iaPersistente);
    const now = new Date();
    const inicio = parseDate(payload.dates?.[0]);
    const fin = parseDate(payload.dates?.[1]);

    const resultado = await prisma.$transaction(async (tx) => {
      const itinerario = await tx.itinerario.create({
        data: {
          id_usuario: idUsuario,
          titulo: `Itinerario ${destination}`,
          destino: destination,
          inicio,
          fin,
          presupuesto: presupuestoToInt(payload.budget),
          transporte: payload.transport,
          accesibilidad: payload.pace,
          estado: "generado_ia_v1",
          creado: now,
          actualizado: now,
          base_nombre: payload.base_location_name,
          base_direccion: payload.base_address,
          base_place_id: payload.base_place_id || null,
          base_latitud: payload.base_lat,
          base_longitud: payload.base_lon,
          permite_excursiones: Boolean(payload.allow_excursions),
          radio_max_km: payload.max_distance_km ?? null,
          ia_json: iaPersistente,
          ia_resumen: ia.summary ?? ia.resumen ?? null,
          preferencias_json: payload,
        },
      });

      for (const day of dayPlans) {
        const fecha = inicio
          ? new Date(inicio.getTime() + (day.day_number - 1) * 86400000)
          : null;

        const dia = await tx.dia_Itinerario.create({
          data: {
            id_itinerario: itinerario.id_itinerario,
            fecha,
            minutos: day.total_minutes,
            notas: [day.theme, ...day.local_tips]
              .filter(Boolean)
              .join(" | ")
              .slice(0, 1000),
          },
        });

        for (const [index, poiIa] of day.pois.entries()) {
          const globalId = getPoiGlobalId(poiIa);
          const name = getPoiName(poiIa);

          const poi = globalId
            ? await tx.poi.findUnique({
                where: { id_global: globalId },
                select: { id_poi: true },
              })
            : await tx.poi.findFirst({
                where: { nombre: { contains: name, mode: "insensitive" } },
                select: { id_poi: true },
              });

          if (!poi) continue;

          await tx.elemento_Itinerario.create({
            data: {
              id_dia_itinerario: dia.id_dia_itinerario,
              id_poi: poi.id_poi,
              orden: index + 1,
              transporte: payload.transport || null,
            },
          });
        }
      }

      const conversacion = await tx.conversacion.create({
        data: {
          id_usuario: idUsuario,
          titulo: `Itinerario ${destination}`,
          creado: now,
        },
      });

      await tx.mensaje.createMany({
        data: [
          {
            id_conversacion: conversacion.id_conversacion,
            rol: "user",
            contenido: mensajeUsuario(payload),
            creado: now,
          },
          {
            id_conversacion: conversacion.id_conversacion,
            rol: "assistant",
            contenido: resumenAsistente,
            creado: now,
          },
        ],
      });

      const itinerarioCompleto = await tx.itinerario.findUnique({
        where: { id_itinerario: itinerario.id_itinerario },
        include: {
          dias: {
            orderBy: { fecha: "asc" },
            include: {
              elementos: {
                orderBy: { orden: "asc" },
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
            },
          },
        },
      });

      return { itinerario: itinerarioCompleto ?? itinerario, conversacion };
    });

    return reply.code(201).send({
      ok: true,
      id_conversacion: resultado.conversacion.id_conversacion,
      id_itinerario: resultado.itinerario.id_itinerario,
      respuesta: resumenAsistente,
      payload,
      itinerario: resultado.itinerario,
      ia: iaPersistente,
    });
  });
}

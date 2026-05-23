import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import {
  contextoToTexto,
  obtenerContextoUsuarioSpainWay,
  type ContextoUsuarioSpainWay,
} from "./recomendador-contexto.service";
import {
  obtenerContextoMeteorologicoSpainWay,
  type ContextoMeteorologicoSpainWay,
} from "../meteorologia/meteorologia.service";

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
  include_live_events?: boolean;
  user_message?: string;
  user_context?: ContextoUsuarioSpainWay | null;
  weather_context?: ContextoMeteorologicoSpainWay | null;
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

type LiveEventProvider = "ticketmaster" | "predicthq";

type LiveEvent = {
  id: string;
  provider: LiveEventProvider;
  nombre: string;
  descripcion: string | null;
  categoria: string;
  fechaInicio: string;
  fechaFin: string | null;
  ciudad: string;
  recinto: string | null;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
  imagen: string | null;
  url: string | null;
  score: number;
};

type DiaEventos = {
  day_number: number;
  events: LiveEvent[];
};

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  return (
    poi.categoria_poi?.slug ||
    poi.categoria_poi?.nombre ||
    poi.subcategoria ||
    poi.tipo ||
    "poi"
  );
}

function inferirTemaPorDia(
  dayNumber: number,
  destination: string,
  pois: IaPoi[],
) {
  const texto = pois
    .map((poi) =>
      normalizarTextoBusqueda(
        `${poi.motivo ?? ""} ${poi.reason ?? ""} ${getPoiName(poi)}`,
      ),
    )
    .join(" ");

  if (texto.includes("parque") || texto.includes("naturaleza")) {
    return `${destination} · naturaleza y paseo`;
  }
  if (texto.includes("playa") || texto.includes("costa")) {
    return `${destination} · costa y ambiente local`;
  }
  if (texto.includes("mercado") || texto.includes("gastronomia")) {
    return `${destination} · gastronomía y barrios`;
  }
  if (dayNumber % 3 === 0) return `${destination} · barrios y descubrimiento`;
  if (dayNumber % 2 === 0) return `${destination} · cultura y patrimonio`;
  return `${destination} · imprescindibles cercanos`;
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

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function parseDateTimeSafe(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
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

function getEventStartHour(event: LiveEvent): number {
  const date = parseDateTimeSafe(event.fechaInicio);
  return date ? date.getUTCHours() : 12;
}

function getTripDateRange(payload: PayloadRecomendador): {
  from: string;
  to: string;
} | null {
  const dates = Array.isArray(payload.dates) ? payload.dates : [];
  const validDates = dates
    .map((d) => d?.trim())
    .filter((d): d is string => Boolean(d));

  if (validDates.length >= 2) {
    const fromDate = parseDate(validDates[0]);
    const toDate = parseDate(validDates[1]);

    if (fromDate && toDate) {
      return {
        from: toYmd(fromDate),
        to: toYmd(toDate),
      };
    }
  }

  if (validDates.length === 1) {
    const start = parseDate(validDates[0]);
    const days = Math.max(1, Number(payload.days ?? 1));
    if (start) {
      const end = addDays(start, days - 1);
      return {
        from: toYmd(start),
        to: toYmd(end),
      };
    }
  }

  return null;
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
  const negative = normalizarTextoBusqueda(
    (payload.negative_preferences ?? []).join(" "),
  );
  const preferencias = `${tripType} ${mustSee} ${extras}`;
  const destinationNorm = normalizarTextoBusqueda(destination);

  const excludedIds = new Set(
    excludedGlobalIds.map((id) => id.trim()).filter(Boolean),
  );
  const excludedNamesNorm = excludedNames
    .map(normalizarTextoBusqueda)
    .filter(Boolean);
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
        {
          municipio: { nombre: { contains: destination, mode: "insensitive" } },
        },
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
      if (
        excludedNamesNorm.some(
          (name) => nombreNorm.includes(name) || name.includes(nombreNorm),
        )
      ) {
        return null;
      }

      if (negative.includes("playa") && categoriaNorm.includes("playa")) {
        return null;
      }
      if (
        negative.includes("museo") &&
        (nombreNorm.includes("museo") || categoriaNorm.includes("cultura"))
      ) {
        return null;
      }

      const dist = distanciaKm(baseLat, baseLon, lat, lon);
      const categoriaPreferida =
        (preferencias.includes("cultural") &&
          (categoriaNorm.includes("cultura") ||
            categoriaNorm.includes("patrimonio") ||
            nombreNorm.includes("museo"))) ||
        (preferencias.includes("naturaleza") &&
          (categoriaNorm.includes("naturaleza") ||
            nombreNorm.includes("parque"))) ||
        (preferencias.includes("gastronomia") &&
          (categoriaNorm.includes("gastronomia") ||
            nombreNorm.includes("mercado"))) ||
        (preferencias.includes("costa") && categoriaNorm.includes("playa")) ||
        (mustSee.length > 2 &&
          (mustSee.includes(nombreNorm) || nombreNorm.includes(mustSee)));

      const scoreDistancia = Math.max(0, 90 - dist * 8);
      const scoreCategoria = categoriaPreferida ? 40 : 0;
      const scorePopularidad = Number(poi.popularidad ?? 0) * 0.8;
      const scorePuntuacion = Number(poi.puntuacion ?? 0) * 8;
      const scoreDireccion =
        destinationNorm && direccionNorm.includes(destinationNorm) ? 10 : 0;

      return {
        poi,
        score:
          scoreDistancia +
          scoreCategoria +
          scorePopularidad +
          scorePuntuacion +
          scoreDireccion,
        dist,
        categoria,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.score - a.score);

  return filtrados.map((item) => {
    const distText =
      item.dist <= 1.2
        ? "muy cerca"
        : item.dist <= 5
          ? "cerca"
          : "a distancia razonable";
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
  const complementarios = await buscarPoisComplementariosDesdeBbdd(
    payload,
    excludedGlobalIds,
    excludedNames,
    dayPlans,
  );

  const excludedIds = new Set(
    excludedGlobalIds.map((id) => id.trim()).filter(Boolean),
  );
  const excludedNamesNorm = excludedNames
    .map(normalizarTextoBusqueda)
    .filter(Boolean);
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();

  const pool = [
    ...dayPlans.flatMap((day) => day.pois),
    ...(Array.isArray(ia.items) ? ia.items : []),
    ...complementarios,
  ].filter((poi) => {
    const globalId = getPoiGlobalId(poi);
    const nombre = normalizarTextoBusqueda(getPoiName(poi));
    if (globalId && excludedIds.has(globalId)) return false;
    return !excludedNamesNorm.some(
      (name) => nombre.includes(name) || name.includes(nombre),
    );
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
      total_minutes:
        original?.total_minutes ?? (pois.length > 0 ? pois.length * 80 : 0),
      pois,
      local_tips:
        original?.local_tips && original.local_tips.length > 0
          ? original.local_tips
          : pois.length > 0
            ? [
                "Día completado con POIs de la base completa, evitando repeticiones y exclusiones del usuario.",
              ]
            : [
                "No se encontraron suficientes POIs compatibles para completar este día.",
              ],
    });
  }

  return result;
}

async function llamarModeloIa(
  payload: PayloadRecomendador,
): Promise<IaResponse> {
  const baseUrl = process.env.RECOMMENDER_API_URL || "https://spainway-ia.onrender.com";

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

function esCategoriaEventoNoDeseada(categoria: string): boolean {
  const c = normalizarTextoBusqueda(categoria);

  return (
    c.includes("observances") ||
    c.includes("public holidays") ||
    c.includes("public holiday") ||
    c.includes("holiday")
  );
}

function esEventoPocoTuristicoPorNombre(nombre: string): boolean {
  const n = normalizarTextoBusqueda(nombre);

  return (
    n.includes("whit sunday") ||
    n.includes("whit monday") ||
    n.includes("pentecost") ||
    n === "juventud"
  );
}

function scoreHorarioEvento(event: LiveEvent): number {
  const hour = getEventStartHour(event);

  if (hour >= 18 && hour <= 23) return 35;
  if (hour >= 16 && hour < 18) return 25;
  if (hour >= 12 && hour < 16) return 8;
  if (hour >= 9 && hour < 12) return -10;
  return -20;
}

function scoreCategoriaEvento(event: LiveEvent): number {
  const c = normalizarTextoBusqueda(event.categoria);

  if (c.includes("music") || c.includes("concert")) return 18;
  if (c.includes("theatre") || c.includes("performing")) return 16;
  if (c.includes("festival")) return 16;
  if (c.includes("arts")) return 10;
  if (c.includes("community")) return 6;
  if (c.includes("sports")) return 8;
  if (c.includes("expo")) return 4;
  return 0;
}

function scoreCalidadEvento(event: LiveEvent): number {
  let score = 0;

  if (event.imagen) score += 8;
  if (event.url) score += 8;
  if (event.recinto) score += 6;
  if (event.descripcion) score += 5;
  if (event.provider === "ticketmaster") score += 10;

  return score;
}

function scoreDistanciaEvento(
  event: LiveEvent,
  baseLat: number,
  baseLon: number,
): number {
  if (event.latitud === null || event.longitud === null) return -8;

  const dist = distanciaKm(baseLat, baseLon, event.latitud, event.longitud);

  if (dist <= 2) return 22;
  if (dist <= 5) return 16;
  if (dist <= 10) return 10;
  if (dist <= 20) return 2;
  if (dist <= 35) return -10;
  return -30;
}

function enriquecerYFiltrarEventos(
  events: LiveEvent[],
  payload: PayloadRecomendador,
): LiveEvent[] {
  const baseLat = Number(payload.base_lat);
  const baseLon = Number(payload.base_lon);
  const maxDistanceKm = clamp(
    Number(payload.max_distance_km ?? 30),
    8,
    50,
  );

  const vistos = new Set<string>();

  return events
    .filter((event) => {
      if (!event.nombre || !event.fechaInicio) return false;
      if (esCategoriaEventoNoDeseada(event.categoria)) return false;
      if (esEventoPocoTuristicoPorNombre(event.nombre)) return false;

      if (
        event.latitud !== null &&
        event.longitud !== null &&
        Number.isFinite(baseLat) &&
        Number.isFinite(baseLon)
      ) {
        const dist = distanciaKm(baseLat, baseLon, event.latitud, event.longitud);
        if (dist > maxDistanceKm) return false;
      }

      const key = [
        normalizarTextoBusqueda(event.nombre),
        event.fechaInicio.slice(0, 10),
        normalizarTextoBusqueda(event.recinto ?? ""),
      ].join("|");

      if (vistos.has(key)) return false;
      vistos.add(key);

      return true;
    })
    .map((event) => {
      const scoreExtra =
        scoreHorarioEvento(event) +
        scoreCategoriaEvento(event) +
        scoreCalidadEvento(event) +
        scoreDistanciaEvento(event, baseLat, baseLon);

      return {
        ...event,
        score: Number(event.score ?? 0) + scoreExtra,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 24);
}

async function obtenerEventosLiveParaViaje(
  app: FastifyInstance,
  payload: PayloadRecomendador,
): Promise<LiveEvent[]> {
  const range = getTripDateRange(payload);
  if (!range) return [];

  const destination = (payload.destination ?? "").trim();
  if (!destination) return [];

  const query = new URLSearchParams({
    city: destination,
    from: range.from,
    to: range.to,
  });

  if (payload.base_lat !== null && payload.base_lat !== undefined) {
    query.set("lat", String(payload.base_lat));
  }

  if (payload.base_lon !== null && payload.base_lon !== undefined) {
    query.set("lng", String(payload.base_lon));
  }

  if (payload.max_distance_km !== null && payload.max_distance_km !== undefined) {
    query.set("radiusKm", String(clamp(Number(payload.max_distance_km), 8, 50)));
  }

  const response = await app.inject({
    method: "GET",
    url: `/api/eventos-live/search?${query.toString()}`,
  });

  if (response.statusCode >= 400) {
    app.log.error(
      { statusCode: response.statusCode, body: response.body },
      "Error consultando eventos-live desde recomendador",
    );
    return [];
  }

  const data = response.json() as {
    events?: LiveEvent[];
  };

  const events = Array.isArray(data.events) ? data.events : [];
  return enriquecerYFiltrarEventos(events, payload);
}

function asignarEventosPorDia(
  events: LiveEvent[],
  payload: PayloadRecomendador,
): DiaEventos[] {
  const range = getTripDateRange(payload);
  const days = Number(payload.days ?? 1);

  const result: DiaEventos[] = Array.from({ length: days }, (_, index) => ({
    day_number: index + 1,
    events: [],
  }));

  if (!range) return result;

  const fromDate = parseDateOnly(range.from);
  const grouped = new Map<number, LiveEvent[]>();

  for (const event of events) {
    const start = parseDateTimeSafe(event.fechaInicio);
    if (!start) continue;

    const diffDays = Math.floor(
      (parseDateOnly(toYmd(start)).getTime() - fromDate.getTime()) / 86400000,
    );
    const dayNumber = diffDays + 1;

    if (dayNumber < 1 || dayNumber > days) continue;

    const list = grouped.get(dayNumber) ?? [];
    list.push(event);
    grouped.set(dayNumber, list);
  }

  for (const day of result) {
    const candidates = (grouped.get(day.day_number) ?? [])
      .sort((a, b) => b.score - a.score)
      .sort((a, b) => scoreHorarioEvento(b) - scoreHorarioEvento(a));

    const selected: LiveEvent[] = [];
    const usedNames = new Set<string>();

    for (const event of candidates) {
      const nombreNorm = normalizarTextoBusqueda(event.nombre);
      if (usedNames.has(nombreNorm)) continue;

      selected.push(event);
      usedNames.add(nombreNorm);

      const hour = getEventStartHour(event);

      if (selected.length >= 2) break;
      if (selected.length >= 1 && hour >= 16) continue;
    }

    day.events = selected.slice(0, 2);
  }

  return result;
}

function insertarEventosEnTips(
  dayPlans: DiaNormalizado[],
  eventosPorDia: DiaEventos[],
): DiaNormalizado[] {
  const map = new Map<number, LiveEvent[]>(
    eventosPorDia.map((item) => [item.day_number, item.events]),
  );

  return dayPlans.map((day) => {
    const eventos = map.get(day.day_number) ?? [];
    if (eventos.length === 0) return day;

    const tipsEventos = eventos.map((event) => {
      const start = parseDateTimeSafe(event.fechaInicio);
      const hora = start ? start.toISOString().slice(11, 16) : "sin hora";

      return `Evento recomendado (${hora}): ${event.nombre}${event.recinto ? ` en ${event.recinto}` : ""}.`;
    });

    return {
      ...day,
      local_tips: [...day.local_tips, ...tipsEventos],
    };
  });
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
    `Include live events: ${payload.include_live_events === true ? "sí" : "no"}.`,
  ].join("\n");
}

function mensajeAsistente(
  ia: IaResponse,
  eventosPorDia: DiaEventos[],
) {
  const dayPlans = getDayPlans(ia);
  const resumen =
    ia.summary ??
    ia.resumen ??
    "Itinerario generado correctamente por el recomendador.";
  const anchors =
    Array.isArray(ia.anchors_used) && ia.anchors_used.length > 0
      ? ia.anchors_used.join(", ")
      : "ninguna";

  const mapEventos = new Map<number, LiveEvent[]>(
    eventosPorDia.map((item) => [item.day_number, item.events]),
  );

  const dias = dayPlans
    .map((day) => {
      const pois = day.pois
        .map((poi) => {
          const reason = getPoiReason(poi);
          return `- ${getPoiName(poi)}${reason ? `: ${reason}` : ""}`;
        })
        .join("\n");

      const eventos = (mapEventos.get(day.day_number) ?? [])
        .map((event) => {
          const start = parseDateTimeSafe(event.fechaInicio);
          const hora = start ? start.toISOString().slice(11, 16) : "sin hora";
          return `- Evento sugerido ${hora}: ${event.nombre}${event.recinto ? ` · ${event.recinto}` : ""}`;
        })
        .join("\n");

      const tips =
        day.local_tips.length > 0
          ? `\nConsejos: ${day.local_tips.join(" | ")}`
          : "";

      const bloqueEventos = eventos ? `\nEventos:\n${eventos}` : "";

      return `Día ${day.day_number} · ${day.theme}\n${pois || "Sin POIs asignados."}${bloqueEventos}${tips}`;
    })
    .join("\n\n");

  return [resumen, "", `Anclas usadas: ${anchors}.`, "", dias]
    .filter(Boolean)
    .join("\n");
}

function crearJsonPersistente(
  ia: IaResponse,
  dayPlans: DiaNormalizado[],
  eventosPorDia: DiaEventos[],
  liveEvents: LiveEvent[],
) {
  return {
    ...ia,
    day_plans: dayPlans,
    live_events: liveEvents,
    live_events_by_day: eventosPorDia,
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

    let payload: PayloadRecomendador = {
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
      include_live_events: body.include_live_events === true,
      user_message: typeof body.user_message === "string" ? body.user_message : undefined,
    };

    const [userContext, weatherContext] = await Promise.all([
      obtenerContextoUsuarioSpainWay(idUsuario).catch((error) => {
        request.log.warn(error, "No se pudo recuperar el contexto del usuario");
        return null;
      }),
      obtenerContextoMeteorologicoSpainWay({
        lat: Number(payload.base_lat),
        lon: Number(payload.base_lon),
        dates: payload.dates,
        days: Number(payload.days ?? 1),
      }).catch((error) => {
        request.log.warn(error, "No se pudo recuperar la meteorología");
        return null;
      }),
    ]);

    const contextoTexto = userContext ? contextoToTexto(userContext) : "";
    const notasConContexto = [payload.notes, contextoTexto]
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .join("\n");

    payload = {
      ...payload,
      notes: notasConContexto,
      user_context: userContext,
      weather_context: weatherContext,
    };

    let ia: IaResponse;
    try {
      ia = await llamarModeloIa(payload);
    } catch (error) {
      request.log.error(error);
      return reply.code(502).send({
        ok: false,
        message:
          `No se pudo conectar con el modelo IA. URL configurada: ${process.env.RECOMMENDER_API_URL || "https://spainway-ia.onrender.com"}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const dayPlansIniciales = getDayPlans(ia);
    const dayPlansFiltrados = filtrarPoisExcluidos(
      dayPlansIniciales,
      visitedGlobalIdsFinales,
      nombresExcluidosPorTexto,
    );

    const dayPlansBase = await completarDiasConBbdd(
      ia,
      dayPlansFiltrados,
      payload,
      visitedGlobalIdsFinales,
      nombresExcluidosPorTexto,
    );

    const incluirEventosLive = payload.include_live_events === true;

    const liveEvents = incluirEventosLive
      ? await obtenerEventosLiveParaViaje(app, payload)
      : [];

    const eventosPorDia = incluirEventosLive
      ? asignarEventosPorDia(liveEvents, payload)
      : Array.from({ length: payload.days ?? 1 }, (_, index) => ({
          day_number: index + 1,
          events: [],
        }));

    const dayPlans = incluirEventosLive
      ? insertarEventosEnTips(dayPlansBase, eventosPorDia)
      : dayPlansBase;

    const iaPersistente = crearJsonPersistente(
      ia,
      dayPlans,
      eventosPorDia,
      liveEvents,
    );

    const resumenAsistente = mensajeAsistente(iaPersistente, eventosPorDia);

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
          estado: incluirEventosLive
            ? "generado_ia_v2_con_eventos_live"
            : "generado_ia_v2",
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

      const diasCreados = new Map<number, number>();

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

        diasCreados.set(day.day_number, dia.id_dia_itinerario);

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

      if (incluirEventosLive) {
        for (const diaEventos of eventosPorDia) {
          const idDiaItinerario = diasCreados.get(diaEventos.day_number);
          if (!idDiaItinerario) continue;

          for (const [index, event] of diaEventos.events.entries()) {
            const eventoTuristico = await tx.evento_Turistico.upsert({
              where: {
                external_id: event.id,
              },
              update: {
                source: event.provider,
                nombre: event.nombre.slice(0, 300),
                descripcion: event.descripcion?.slice(0, 2000) ?? null,
                categoria: event.categoria?.slice(0, 100) ?? null,
                subcategoria: null,
                venue_nombre: event.recinto?.slice(0, 250) ?? null,
                direccion: event.direccion?.slice(0, 400) ?? null,
                ciudad: event.ciudad?.slice(0, 120) ?? null,
                provincia: null,
                comunidad: null,
                latitud: event.latitud,
                longitud: event.longitud,
                inicio: new Date(event.fechaInicio),
                fin: event.fechaFin ? new Date(event.fechaFin) : null,
                imagen_url: event.imagen?.slice(0, 700) ?? null,
                url: event.url?.slice(0, 700) ?? null,
                precio_min: null,
                precio_max: null,
                moneda: null,
                activo: true,
                metadata_json: event,
                fetched_at: now,
              },
              create: {
                external_id: event.id,
                source: event.provider,
                nombre: event.nombre.slice(0, 300),
                descripcion: event.descripcion?.slice(0, 2000) ?? null,
                categoria: event.categoria?.slice(0, 100) ?? null,
                subcategoria: null,
                venue_nombre: event.recinto?.slice(0, 250) ?? null,
                direccion: event.direccion?.slice(0, 400) ?? null,
                ciudad: event.ciudad?.slice(0, 120) ?? null,
                provincia: null,
                comunidad: null,
                latitud: event.latitud,
                longitud: event.longitud,
                inicio: new Date(event.fechaInicio),
                fin: event.fechaFin ? new Date(event.fechaFin) : null,
                imagen_url: event.imagen?.slice(0, 700) ?? null,
                url: event.url?.slice(0, 700) ?? null,
                precio_min: null,
                precio_max: null,
                moneda: null,
                activo: true,
                metadata_json: event,
                fetched_at: now,
              },
            });

            await tx.itinerario_Evento.create({
              data: {
                id_itinerario: itinerario.id_itinerario,
                id_dia_itinerario: idDiaItinerario,
                id_evento_turistico: eventoTuristico.id_evento_turistico,
                orden: index + 1,
                inicio_sugerido: new Date(event.fechaInicio),
                fin_sugerido: event.fechaFin ? new Date(event.fechaFin) : null,
                score_recomendacion: event.score,
                motivo: `Evento live recomendado para la franja de tarde/noche del día ${diaEventos.day_number}. Fuente: ${event.provider}.`,
              },
            });
          }
        }
      }

      const conversacion = await tx.conversacion.create({
        data: {
          id_usuario: idUsuario,
          id_itinerario: itinerario.id_itinerario,
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
              eventos: {
                orderBy: { orden: "asc" },
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
            orderBy: [{ id_dia_itinerario: "asc" }, { orden: "asc" }],
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
      eventos_live_total: liveEvents.length,
      eventos_live_por_dia: eventosPorDia,
    });
  });
}
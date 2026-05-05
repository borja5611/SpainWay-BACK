import { FastifyInstance } from "fastify";
import axios from "axios";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";

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

type TicketmasterVenue = {
  name?: string;
  city?: { name?: string };
  address?: { line1?: string };
  location?: {
    latitude?: string;
    longitude?: string;
  };
};

type TicketmasterImage = {
  url?: string;
  width?: number;
  ratio?: string;
};

type TicketmasterEvent = {
  id: string;
  name?: string;
  info?: string;
  pleaseNote?: string;
  url?: string;
  images?: TicketmasterImage[];
  dates?: {
    start?: {
      localDate?: string;
      localTime?: string;
      dateTime?: string;
    };
    end?: {
      localDate?: string;
      localTime?: string;
      dateTime?: string;
    };
  };
  classifications?: Array<{
    segment?: { name?: string };
    genre?: { name?: string };
    subGenre?: { name?: string };
  }>;
  _embedded?: {
    venues?: TicketmasterVenue[];
  };
};

type TicketmasterResponse = {
  _embedded?: {
    events?: TicketmasterEvent[];
  };
};

type PredictHQEvent = {
  id: string;
  title?: string;
  description?: string;
  category?: string;
  start?: string;
  end?: string;
  rank?: number;
  local_rank?: number;
  location?: [number, number];
  entities?: Array<{
    name?: string;
    type?: string;
  }>;
};

type PredictHQResponse = {
  results?: PredictHQEvent[];
};

type SearchAttempt = {
  code: "A" | "B" | "C" | "D";
  label: string;
  from: string;
  to: string;
  radiusKm: number;
  useCityForTicketmaster: boolean;
  useCityForPredictHQ: boolean;
};

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizarTexto(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function parseDateTimeSafe(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDaysYmd(value: string, days: number): string {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildStartIso(from: string): string {
  return `${from}T00:00:00Z`;
}

function buildEndIso(to: string): string {
  return `${to}T23:59:59Z`;
}

function getLocalYmdMadrid(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function pickBestImage(images: TicketmasterImage[] | undefined): string | null {
  if (!images || images.length === 0) return null;

  const preferred =
    images.find((img) => img.ratio === "16_9" && (img.width ?? 0) >= 500) ??
    images.find((img) => img.ratio === "16_9") ??
    images[0];

  return preferred?.url ?? null;
}

function buildTicketmasterDate(event: TicketmasterEvent): {
  start: string | null;
  end: string | null;
} {
  const startDateTime = event.dates?.start?.dateTime;
  const startLocalDate = event.dates?.start?.localDate;
  const startLocalTime = event.dates?.start?.localTime ?? "00:00:00";

  const endDateTime = event.dates?.end?.dateTime;
  const endLocalDate = event.dates?.end?.localDate;
  const endLocalTime = event.dates?.end?.localTime ?? "23:59:59";

  const start =
    startDateTime ??
    (startLocalDate ? `${startLocalDate}T${startLocalTime}` : null);

  const end =
    endDateTime ??
    (endLocalDate ? `${endLocalDate}T${endLocalTime}` : null);

  return { start, end };
}

function mapTicketmasterEvent(event: TicketmasterEvent, fallbackCity: string): LiveEvent {
  const venue = event._embedded?.venues?.[0];
  const dates = buildTicketmasterDate(event);

  const categoria =
    event.classifications?.[0]?.segment?.name ??
    event.classifications?.[0]?.genre?.name ??
    event.classifications?.[0]?.subGenre?.name ??
    "Evento";

  return {
    id: `ticketmaster_${event.id}`,
    provider: "ticketmaster",
    nombre: event.name?.trim() || "Evento Ticketmaster",
    descripcion: event.info?.trim() || event.pleaseNote?.trim() || null,
    categoria,
    fechaInicio: dates.start || "",
    fechaFin: dates.end,
    ciudad: venue?.city?.name?.trim() || fallbackCity,
    recinto: venue?.name?.trim() || null,
    direccion: venue?.address?.line1?.trim() || null,
    latitud: toNumber(venue?.location?.latitude),
    longitud: toNumber(venue?.location?.longitude),
    imagen: pickBestImage(event.images),
    url: event.url?.trim() || null,
    score: 85,
  };
}

function mapPredictHQEvent(event: PredictHQEvent, city: string): LiveEvent {
  const lng = Array.isArray(event.location) ? toNumber(event.location[0]) : null;
  const lat = Array.isArray(event.location) ? toNumber(event.location[1]) : null;

  const entidadRecinto =
    event.entities?.find((entity) => entity.type === "venue")?.name ??
    event.entities?.[0]?.name ??
    null;

  return {
    id: `predicthq_${event.id}`,
    provider: "predicthq",
    nombre: event.title?.trim() || "Evento PredictHQ",
    descripcion: event.description?.trim() || null,
    categoria: event.category?.trim() || "Evento",
    fechaInicio: event.start?.trim() || "",
    fechaFin: event.end?.trim() || null,
    ciudad: city,
    recinto: entidadRecinto,
    direccion: null,
    latitud: lat,
    longitud: lng,
    imagen: null,
    url: null,
    score: toNumber(event.rank) ?? toNumber(event.local_rank) ?? 70,
  };
}

function filtrarPorFechas(events: LiveEvent[], from: string, to: string): LiveEvent[] {
  const desde = parseDateOnly(from);
  const hasta = new Date(`${to}T23:59:59.999Z`);

  return events.filter((event) => {
    if (!event.fechaInicio) return false;

    const inicio = parseDateTimeSafe(event.fechaInicio);
    if (!inicio) return false;

    return inicio >= desde && inicio <= hasta;
  });
}

function esCategoriaPermitida(categoria: string): boolean {
  const c = normalizarTexto(categoria);

  return (
    c.includes("concert") ||
    c.includes("music") ||
    c.includes("festival") ||
    c.includes("performing") ||
    c.includes("theatre") ||
    c.includes("theater") ||
    c.includes("arts") ||
    c.includes("sports") ||
    c.includes("community") ||
    c.includes("expo")
  );
}

function esCategoriaBloqueada(categoria: string): boolean {
  const c = normalizarTexto(categoria);

  return (
    c.includes("observances") ||
    c.includes("observance") ||
    c.includes("public holidays") ||
    c.includes("public holiday") ||
    c.includes("holiday")
  );
}

function esTextoBloqueado(nombre: string, descripcion?: string | null): boolean {
  const text = normalizarTexto(`${nombre} ${descripcion ?? ""}`);

  return (
    text.includes("holiday") ||
    text.includes("observance") ||
    text.includes("saint") ||
    text.includes("pentecost") ||
    text.includes("whit") ||
    text.includes("baptist")
  );
}

function limpiarNombreBase(nombre: string): string {
  return normalizarTexto(nombre)
    .replace(/\bvip packages?\b/g, "")
    .replace(/\bvip\b/g, "")
    .replace(/\bpackage\b/g, "")
    .replace(/\bworld tour\b/g, "")
    .replace(/\btour\b/g, "")
    .replace(/\blive\b/g, "")
    .replace(/\bofficial\b/g, "")
    .replace(/\ben madrid\b/g, "")
    .replace(/\bin madrid\b/g, "")
    .replace(/\barirang\b/g, "arirang")
    .replace(/\s+/g, " ")
    .trim();
}

function sonTitulosParecidos(a: string, b: string) {
  const aa = limpiarNombreBase(a);
  const bb = limpiarNombreBase(b);

  if (!aa || !bb) return false;
  if (aa === bb) return true;
  if (aa.includes(bb) || bb.includes(aa)) return true;

  const tokensA = new Set(aa.split(" ").filter(Boolean));
  const tokensB = new Set(bb.split(" ").filter(Boolean));

  let comunes = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) comunes += 1;
  }

  const minTokens = Math.min(tokensA.size, tokensB.size);
  return minTokens > 0 && comunes / minTokens >= 0.7;
}

function scoreHorarioEvento(event: LiveEvent): number {
  const date = parseDateTimeSafe(event.fechaInicio);
  const hour = date ? date.getUTCHours() : 12;

  if (hour >= 18 && hour <= 23) return 35;
  if (hour >= 16 && hour < 18) return 25;
  if (hour >= 12 && hour < 16) return 8;
  if (hour >= 9 && hour < 12) return -6;
  return -15;
}

function scoreCategoriaEvento(event: LiveEvent): number {
  const c = normalizarTexto(event.categoria);

  if (c.includes("music") || c.includes("concert")) return 18;
  if (c.includes("festival")) return 18;
  if (c.includes("theatre") || c.includes("performing")) return 16;
  if (c.includes("arts")) return 10;
  if (c.includes("sports")) return 8;
  if (c.includes("community")) return 6;
  if (c.includes("expo")) return 4;
  return 0;
}

function enriquecerScore(event: LiveEvent): LiveEvent {
  return {
    ...event,
    score:
      Number(event.score ?? 0) +
      scoreHorarioEvento(event) +
      scoreCategoriaEvento(event) +
      (event.imagen ? 8 : 0) +
      (event.url ? 6 : 0) +
      (event.recinto ? 6 : 0),
  };
}

function esEventoDebil(event: LiveEvent) {
  const tieneCalidadMinima =
    Boolean(event.recinto) || Boolean(event.url) || Boolean(event.imagen);

  return !tieneCalidadMinima && scoreCategoriaEvento(event) < 8;
}

function deduplicarEventos(events: LiveEvent[]) {
  const ordenados = [...events]
    .map(enriquecerScore)
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));

  const resultado: LiveEvent[] = [];

  for (const event of ordenados) {
    const fechaLocal = getLocalYmdMadrid(event.fechaInicio) ?? "";
    const venue = normalizarTexto(event.recinto ?? "");
    const existe = resultado.find((saved) => {
      const fechaSaved = getLocalYmdMadrid(saved.fechaInicio) ?? "";
      const sameDay = fechaLocal === fechaSaved;
      const venueSaved = normalizarTexto(saved.recinto ?? "");
      const sameVenue =
        venue && venueSaved ? venue === venueSaved : false;

      const titleSimilar = sonTitulosParecidos(event.nombre, saved.nombre);

      return sameDay && (sameVenue || titleSimilar);
    });

    if (!existe) {
      resultado.push(event);
      continue;
    }

    const scoreNuevo = Number(event.score ?? 0);
    const scoreExistente = Number(existe.score ?? 0);

    if (scoreNuevo > scoreExistente) {
      const index = resultado.findIndex((item) => item.id === existe.id);
      if (index >= 0) resultado[index] = event;
    }
  }

  return resultado;
}

function enriquecerYFiltrarEventos(events: LiveEvent[]): LiveEvent[] {
  return deduplicarEventos(
    events.filter((event) => {
      if (!event.nombre || !event.fechaInicio) return false;
      if (esCategoriaBloqueada(event.categoria)) return false;
      if (!esCategoriaPermitida(event.categoria)) return false;
      if (esTextoBloqueado(event.nombre, event.descripcion)) return false;
      if (normalizarTexto(event.nombre).includes("vip package")) return false;
      if (esEventoDebil(event)) return false;
      return true;
    }),
  )
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, 50);
}

async function resolverCoordenadasCiudad(city: string): Promise<{
  latitud: number | null;
  longitud: number | null;
}> {
  const municipio = await prisma.municipio.findFirst({
    where: {
      nombre: {
        equals: city,
        mode: "insensitive",
      },
    },
    select: {
      latitud: true,
      longitud: true,
    },
  });

  return {
    latitud: municipio?.latitud ?? null,
    longitud: municipio?.longitud ?? null,
  };
}

async function fetchTicketmasterEvents(params: {
  city: string;
  from: string;
  to: string;
  latitud: number | null;
  longitud: number | null;
  radiusKm: number;
  useCity: boolean;
}): Promise<LiveEvent[]> {
  if (!env.TICKETMASTER_API_KEY) return [];

  try {
    const requestParams: Record<string, string | number> = {
      apikey: env.TICKETMASTER_API_KEY,
      countryCode: "ES",
      startDateTime: buildStartIso(params.from),
      endDateTime: buildEndIso(params.to),
      size: 80,
      sort: "date,asc",
    };

    if (params.useCity && params.city.trim()) {
      requestParams.city = params.city.trim();
      requestParams.radius = params.radiusKm;
      requestParams.unit = "km";
    } else if (params.latitud !== null && params.longitud !== null) {
      requestParams.latlong = `${params.latitud},${params.longitud}`;
      requestParams.radius = params.radiusKm;
      requestParams.unit = "km";
    } else {
      return [];
    }

    const response = await axios.get<TicketmasterResponse>(
      "https://app.ticketmaster.com/discovery/v2/events.json",
      {
        params: requestParams,
        timeout: 15000,
      },
    );

    const events = response.data._embedded?.events ?? [];
    return events.map((event) => mapTicketmasterEvent(event, params.city));
  } catch (error) {
    console.error("Error Ticketmaster:", error);
    return [];
  }
}

async function fetchPredictHQEvents(params: {
  city: string;
  from: string;
  to: string;
  latitud: number | null;
  longitud: number | null;
  radiusKm: number;
  useCity: boolean;
}): Promise<LiveEvent[]> {
  if (!env.PREDICTHQ_API_KEY) return [];
  if (params.latitud === null || params.longitud === null) return [];

  try {
    const requestParams: Record<string, string | number> = {
      country: "ES",
      within: `${params.radiusKm}km@${params.latitud},${params.longitud}`,
      "active.gte": buildStartIso(params.from),
      "active.lte": buildEndIso(params.to),
      category: "concerts,festivals,performing-arts,sports,community,expos",
      limit: 80,
    };

    if (params.useCity && params.city.trim()) {
      requestParams.q = params.city.trim();
    }

    const response = await axios.get<PredictHQResponse>(
      "https://api.predicthq.com/v1/events/",
      {
        headers: {
          Authorization: `Bearer ${env.PREDICTHQ_API_KEY}`,
          Accept: "application/json",
        },
        params: requestParams,
        timeout: 15000,
      },
    );

    const events = response.data.results ?? [];
    return events.map((event) => mapPredictHQEvent(event, params.city));
  } catch (error) {
    console.error("Error PredictHQ:", error);
    return [];
  }
}

async function executeAttempt(params: {
  city: string;
  latitud: number | null;
  longitud: number | null;
  attempt: SearchAttempt;
}) {
  const [ticketmasterEvents, predictHQEvents] = await Promise.all([
    fetchTicketmasterEvents({
      city: params.city,
      from: params.attempt.from,
      to: params.attempt.to,
      latitud: params.latitud,
      longitud: params.longitud,
      radiusKm: params.attempt.radiusKm,
      useCity: params.attempt.useCityForTicketmaster,
    }),
    fetchPredictHQEvents({
      city: params.city,
      from: params.attempt.from,
      to: params.attempt.to,
      latitud: params.latitud,
      longitud: params.longitud,
      radiusKm: params.attempt.radiusKm,
      useCity: params.attempt.useCityForPredictHQ,
    }),
  ]);

  const merged = enriquecerYFiltrarEventos(
    filtrarPorFechas(
      [...ticketmasterEvents, ...predictHQEvents],
      params.attempt.from,
      params.attempt.to,
    ),
  );

  return {
    events: merged,
    providers: {
      ticketmaster: ticketmasterEvents.length,
      predicthq: predictHQEvents.length,
    },
  };
}

function buildAttempts(from: string, to: string, requestedRadiusKm: number): SearchAttempt[] {
  return [
    {
      code: "A",
      label: "Ciudad exacta + rango exacto + radio 30",
      from,
      to,
      radiusKm: Math.max(30, requestedRadiusKm),
      useCityForTicketmaster: true,
      useCityForPredictHQ: true,
    },
    {
      code: "B",
      label: "Rango exacto + radio 70",
      from,
      to,
      radiusKm: 70,
      useCityForTicketmaster: false,
      useCityForPredictHQ: true,
    },
    {
      code: "C",
      label: "Rango ampliado ±1 día",
      from: addDaysYmd(from, -1),
      to: addDaysYmd(to, 1),
      radiusKm: 70,
      useCityForTicketmaster: false,
      useCityForPredictHQ: false,
    },
    {
      code: "D",
      label: "Rango ampliado ±3 días sin city exacta",
      from: addDaysYmd(from, -3),
      to: addDaysYmd(to, 3),
      radiusKm: 80,
      useCityForTicketmaster: false,
      useCityForPredictHQ: false,
    },
  ];
}

function buildSuccessMessage(city: string, attempt: SearchAttempt, exactFrom: string, exactTo: string) {
  if (attempt.code === "A") {
    return `Resultados encontrados para ${city} dentro del rango exacto del itinerario.`;
  }

  if (attempt.code === "B") {
    return `No encontramos suficientes eventos exactos para ${city}. Te mostramos resultados ampliando el radio del rango del itinerario.`;
  }

  if (attempt.code === "C") {
    return `No encontramos eventos exactos para ${city} entre ${exactFrom} y ${exactTo}. Te mostramos eventos cercanos ampliando el rango temporal ±1 día.`;
  }

  return `No encontramos eventos exactos para ${city} entre ${exactFrom} y ${exactTo}. Te mostramos eventos cercanos ampliando el rango temporal ±3 días y sin depender de city exacta.`;
}

function buildZeroMessage(city: string, from: string, to: string) {
  return `No encontramos eventos turísticos útiles para ${city} entre ${from} y ${to}, ni siquiera ampliando radio y días cercanos.`;
}

export default async function eventosLiveRoutes(app: FastifyInstance) {
  app.get("/search", async (request, reply) => {
    const query = request.query as {
      city?: string;
      from?: string;
      to?: string;
      lat?: string;
      lng?: string;
      radiusKm?: string;
    };

    const city = (query.city ?? "").trim();
    const from = (query.from ?? "").trim();
    const to = (query.to ?? "").trim();

    if (!city || !from || !to) {
      return reply.code(400).send({
        message: "Parámetros obligatorios: city, from, to",
      });
    }

    const fromDate = parseDateOnly(from);
    const toDate = parseDateOnly(to);

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return reply.code(400).send({
        message: "Formato de fecha inválido. Usa YYYY-MM-DD",
      });
    }

    if (fromDate > toDate) {
      return reply.code(400).send({
        message: "La fecha 'from' no puede ser mayor que 'to'",
      });
    }

    let latitud = toNumber(query.lat);
    let longitud = toNumber(query.lng);

    if (latitud === null || longitud === null) {
      const coords = await resolverCoordenadasCiudad(city);
      latitud = coords.latitud;
      longitud = coords.longitud;
    }

    const requestedRadiusKm = clamp(
      toNumber(query.radiusKm) ?? env.PREDICTHQ_RADIUS_KM,
      20,
      80,
    );

    const attempts = buildAttempts(from, to, requestedRadiusKm);

    const tried: Array<{
      code: string;
      label: string;
      from: string;
      to: string;
      radiusKm: number;
      ticketmaster: number;
      predicthq: number;
      total: number;
    }> = [];

    for (const attempt of attempts) {
      const result = await executeAttempt({
        city,
        latitud,
        longitud,
        attempt,
      });

      tried.push({
        code: attempt.code,
        label: attempt.label,
        from: attempt.from,
        to: attempt.to,
        radiusKm: attempt.radiusKm,
        ticketmaster: result.providers.ticketmaster,
        predicthq: result.providers.predicthq,
        total: result.events.length,
      });

      if (result.events.length > 0) {
        return reply.send({
          city,
          from,
          to,
          coordenadas: {
            latitud,
            longitud,
          },
          search_strategy: {
            success_attempt: attempt.code,
            success_label: attempt.label,
            requested_radius_km: requestedRadiusKm,
            used_from: attempt.from,
            used_to: attempt.to,
            used_radius_km: attempt.radiusKm,
            attempted: tried,
          },
          message: buildSuccessMessage(city, attempt, from, to),
          providers: result.providers,
          total: result.events.length,
          events: result.events,
        });
      }
    }

    return reply.send({
      city,
      from,
      to,
      coordenadas: {
        latitud,
        longitud,
      },
      search_strategy: {
        success_attempt: null,
        success_label: null,
        requested_radius_km: requestedRadiusKm,
        used_from: null,
        used_to: null,
        used_radius_km: null,
        attempted: tried,
      },
      message: buildZeroMessage(city, from, to),
      providers: {
        ticketmaster: 0,
        predicthq: 0,
      },
      total: 0,
      events: [],
    });
  });

  app.get("/selecciones/:idItinerario", async (request, reply) => {
    const params = request.params as { idItinerario?: string };
    const idItinerario = Number(params.idItinerario);

    if (!Number.isInteger(idItinerario) || idItinerario <= 0) {
      return reply.code(400).send({ message: "idItinerario inválido" });
    }

    const selecciones = await prisma.itinerario_Evento.findMany({
      where: {
        id_itinerario: idItinerario,
      },
      include: {
        evento_turistico: true,
      },
      orderBy: [{ id_dia_itinerario: "asc" }, { orden: "asc" }, { creado: "asc" }],
    });

    return reply.send(selecciones);
  });

  app.post("/seleccionar", async (request, reply) => {
    const body = request.body as {
      id_itinerario?: number;
      id_dia_itinerario?: number;
      motivo?: string | null;
      event?: LiveEvent;
    };

    const idItinerario = Number(body.id_itinerario);
    const idDiaItinerario = Number(body.id_dia_itinerario);
    const event = body.event;

    if (!Number.isInteger(idItinerario) || idItinerario <= 0) {
      return reply.code(400).send({ message: "id_itinerario inválido" });
    }

    if (!Number.isInteger(idDiaItinerario) || idDiaItinerario <= 0) {
      return reply.code(400).send({ message: "id_dia_itinerario inválido" });
    }

    if (!event?.id || !event?.nombre || !event?.fechaInicio) {
      return reply.code(400).send({ message: "event inválido" });
    }

    const dia = await prisma.dia_Itinerario.findUnique({
      where: { id_dia_itinerario: idDiaItinerario },
      select: { id_dia_itinerario: true, id_itinerario: true },
    });

    if (!dia || dia.id_itinerario !== idItinerario) {
      return reply.code(404).send({
        message: "El día indicado no pertenece al itinerario",
      });
    }

    const inicioEvento = parseDateTimeSafe(event.fechaInicio);
    const finEvento = parseDateTimeSafe(event.fechaFin);

    if (!inicioEvento) {
      return reply.code(400).send({ message: "fechaInicio inválida" });
    }

    const existente = await prisma.evento_Turistico.upsert({
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
        inicio: inicioEvento,
        fin: finEvento,
        imagen_url: event.imagen?.slice(0, 700) ?? null,
        url: event.url?.slice(0, 700) ?? null,
        precio_min: null,
        precio_max: null,
        moneda: null,
        activo: true,
        metadata_json: event,
        fetched_at: new Date(),
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
        inicio: inicioEvento,
        fin: finEvento,
        imagen_url: event.imagen?.slice(0, 700) ?? null,
        url: event.url?.slice(0, 700) ?? null,
        precio_min: null,
        precio_max: null,
        moneda: null,
        activo: true,
        metadata_json: event,
        fetched_at: new Date(),
      },
    });

    const yaSeleccionado = await prisma.itinerario_Evento.findFirst({
      where: {
        id_itinerario: idItinerario,
        id_dia_itinerario: idDiaItinerario,
        id_evento_turistico: existente.id_evento_turistico,
      },
    });

    if (yaSeleccionado) {
      return reply.send({
        ok: true,
        reused: true,
        seleccion: yaSeleccionado,
      });
    }

    const ordenMax = await prisma.itinerario_Evento.aggregate({
      where: {
        id_itinerario: idItinerario,
        id_dia_itinerario: idDiaItinerario,
      },
      _max: {
        orden: true,
      },
    });

    const seleccion = await prisma.itinerario_Evento.create({
      data: {
        id_itinerario: idItinerario,
        id_dia_itinerario: idDiaItinerario,
        id_evento_turistico: existente.id_evento_turistico,
        orden: (ordenMax._max.orden ?? 0) + 1,
        inicio_sugerido: inicioEvento,
        fin_sugerido: finEvento,
        score_recomendacion: Number(event.score ?? 0),
        motivo:
          body.motivo?.slice(0, 1000) ??
          "Evento live seleccionado manualmente por el usuario.",
      },
      include: {
        evento_turistico: true,
      },
    });

    return reply.code(201).send({
      ok: true,
      seleccion,
    });
  });

  app.delete("/seleccion/:idItinerarioEvento", async (request, reply) => {
    const params = request.params as { idItinerarioEvento?: string };
    const idItinerarioEvento = Number(params.idItinerarioEvento);

    if (!Number.isInteger(idItinerarioEvento) || idItinerarioEvento <= 0) {
      return reply.code(400).send({ message: "idItinerarioEvento inválido" });
    }

    const existente = await prisma.itinerario_Evento.findUnique({
      where: {
        id_itinerario_evento: idItinerarioEvento,
      },
    });

    if (!existente) {
      return reply.code(404).send({ message: "Selección no encontrada" });
    }

    await prisma.itinerario_Evento.delete({
      where: {
        id_itinerario_evento: idItinerarioEvento,
      },
    });

    return reply.send({ ok: true });
  });
}
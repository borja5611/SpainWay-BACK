import { FastifyInstance } from "fastify";
import axios from "axios";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";

type LiveEventProvider = "ticketmaster" | "predicthq" | "serpapi" | "google_local" | "google_maps";

export type LiveEvent = {
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

type SerpApiEvent = {
  title?: string;
  description?: string;
  link?: string;
  thumbnail?: string;
  date?: { start_date?: string; when?: string };
  venue?: { name?: string; address?: string[] | string };
  address?: string[] | string;
  ticket_info?: Array<{ link?: string }>;
};

type SerpApiLocalPlace = {
  title?: string;
  place_id?: string;
  data_id?: string;
  gps_coordinates?: { latitude?: number; longitude?: number };
  rating?: number;
  reviews?: number;
  type?: string;
  types?: string[];
  address?: string;
  description?: string;
  thumbnail?: string;
  website?: string;
  phone?: string;
  hours?: string;
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

type EventosLiveAgregadoResponse = {
  city: string;
  from: string;
  to: string;
  coordenadas: {
    latitud: number | null;
    longitud: number | null;
  };
  search_strategy: {
    success_attempt: string | null;
    success_label: string | null;
    requested_radius_km: number;
    used_from: string | null;
    used_to: string | null;
    used_radius_km: number | null;
    attempted: Array<{
      code: string;
      label: string;
      from: string;
      to: string;
      radiusKm: number;
      ticketmaster: number;
      predicthq: number;
      serpapi: number;
      google_local?: number;
      google_maps?: number;
      total: number;
    }>;
  };
  message: string;
  providers: {
    ticketmaster: number;
    predicthq: number;
    serpapi: number;
    google_local?: number;
    google_maps?: number;
  };
  total: number;
  events: LiveEvent[];
  warnings: string[];
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

function parseSerpAddress(value: unknown): string | null {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || null;
  if (typeof value === "string") return value.trim() || null;
  return null;
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

function mapSerpApiEvent(event: SerpApiEvent, city: string, index: number): LiveEvent {
  const start = event.date?.start_date
    ? `${event.date.start_date}T20:00:00`
    : event.date?.when ?? "";

  return {
    id: `serpapi_${normalizarTexto(event.title ?? "evento").replace(/\s+/g, "_")}_${index}`,
    provider: "serpapi",
    nombre: event.title?.trim() || "Evento Google Events",
    descripcion: event.description?.trim() || null,
    categoria: "Evento local",
    fechaInicio: start,
    fechaFin: null,
    ciudad: city,
    recinto: event.venue?.name?.trim() || null,
    direccion: parseSerpAddress(event.venue?.address) ?? parseSerpAddress(event.address),
    latitud: null,
    longitud: null,
    imagen: event.thumbnail?.trim() || null,
    url: event.link?.trim() || event.ticket_info?.[0]?.link?.trim() || null,
    score: 80,
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
    c.includes("expo") ||
    c.includes("evento") ||
    c.includes("plan local") ||
    c.includes("ocio local") ||
    c.includes("discoteca") ||
    c.includes("club") ||
    c.includes("flamenco") ||
    c.includes("jazz")
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
  if (c.includes("evento")) return 4;
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

  if (event.provider === "google_local" || event.provider === "google_maps") {
    return Number(event.score ?? 0) < 76;
  }

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
      const sameVenue = venue && venueSaved ? venue === venueSaved : false;
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


type EventosCategoria =
  | "all"
  | "music"
  | "theatre"
  | "festivals"
  | "local_fairs"
  | "nightlife"
  | "free"
  | "gastronomy"
  | "family";

const HIGH_QUALITY_NIGHTLIFE_TERMS = [
  "flamenco", "tablao", "jazz", "música en directo", "musica en directo",
  "rooftop", "terraza", "coctelería", "cocteleria", "cocktail",
  "club", "sala", "conciertos", "live music", "dj", "discoteca",
  "pub", "lounge", "azotea", "vermut", "tapas"
];

const LOW_QUALITY_LOCAL_TERMS = [
  "supermercado", "gasolinera", "estanco", "parking", "aparcamiento",
  "hotel", "hostal", "residencia", "tienda", "peluqueria", "farmacia", "banco"
];

function normalizarCategoriaEventos(value?: string | null): EventosCategoria {
  const c = normalizarTexto(value ?? "all");
  if (c.includes("night") || c.includes("noche") || c.includes("discoteca") || c.includes("club") || c.includes("ocio")) return "nightlife";
  if (c.includes("fiesta") || c.includes("feria") || c.includes("verbena") || c.includes("local")) return "local_fairs";
  if (c.includes("music") || c.includes("concierto") || c.includes("musica") || c.includes("música")) return "music";
  if (c.includes("teatro") || c.includes("theatre") || c.includes("theater") || c.includes("monologo") || c.includes("monólogo")) return "theatre";
  if (c.includes("festival")) return "festivals";
  if (c.includes("gratis") || c.includes("free")) return "free";
  if (c.includes("gastr") || c.includes("food") || c.includes("tapas")) return "gastronomy";
  if (c.includes("familia") || c.includes("family") || c.includes("niños") || c.includes("ninos")) return "family";
  return "all";
}

function esCategoriaPlanesLocales(category?: string | null) {
  const c = normalizarCategoriaEventos(category);
  return c === "all" || c === "nightlife" || c === "local_fairs" || c === "gastronomy";
}

function buildGoogleEventsKeyword(city: string, category?: string | null): string {
  const c = normalizarCategoriaEventos(category);
  if (c === "nightlife") return `mejores planes nocturnos conciertos pequeños música en directo discotecas premium en ${city}`;
  if (c === "local_fairs") return `fiestas locales ferias verbenas agenda cultural en ${city}`;
  if (c === "music") return `conciertos música en directo en ${city}`;
  if (c === "theatre") return `teatro monólogos espectáculos en ${city}`;
  if (c === "festivals") return `festivales en ${city}`;
  if (c === "free") return `eventos gratis planes gratis en ${city}`;
  if (c === "gastronomy") return `eventos gastronómicos tapas mercados food en ${city}`;
  if (c === "family") return `eventos familiares planes con niños en ${city}`;
  return `conciertos teatro festivales fiestas locales agenda cultural mejores planes en ${city}`;
}

function buildLocalPlanQueries(city: string, category?: string | null): string[] {
  const c = normalizarCategoriaEventos(category);
  if (c === "nightlife") {
    return [
      `mejores planes nocturnos en ${city}`,
      `discotecas mejor valoradas en ${city}`,
      `bares con música en directo en ${city}`,
      `rooftop cocktail bar en ${city}`,
      `tablao flamenco jazz club en ${city}`,
    ];
  }
  if (c === "local_fairs") return [`fiestas locales en ${city}`, `ferias y verbenas en ${city}`, `agenda cultural local en ${city}`];
  if (c === "gastronomy") return [`mercados gastronómicos en ${city}`, `bares de tapas con ambiente en ${city}`, `experiencias gastronómicas en ${city}`];
  return [`mejores planes nocturnos en ${city}`, `bares con música en directo en ${city}`, `fiestas locales agenda cultural en ${city}`];
}

function scoreLocalPlace(place: SerpApiLocalPlace, query: string): number {
  const rating = toNumber(place.rating) ?? 0;
  const reviews = toNumber(place.reviews) ?? 0;
  const text = normalizarTexto(`${place.title ?? ""} ${place.type ?? ""} ${(place.types ?? []).join(" ")} ${query}`);
  let score = 55;
  if (rating >= 4.7) score += 30;
  else if (rating >= 4.5) score += 24;
  else if (rating >= 4.3) score += 16;
  else if (rating >= 4.1) score += 8;
  else if (rating > 0 && rating < 4.0) score -= 35;
  if (reviews >= 1200) score += 22;
  else if (reviews >= 500) score += 18;
  else if (reviews >= 180) score += 12;
  else if (reviews >= 60) score += 6;
  else if (reviews > 0 && reviews < 25) score -= 12;
  if (HIGH_QUALITY_NIGHTLIFE_TERMS.some((term) => text.includes(term))) score += 18;
  if (place.thumbnail) score += 6;
  if (place.website) score += 5;
  if (place.gps_coordinates?.latitude && place.gps_coordinates?.longitude) score += 5;
  return score;
}

function esPlanLocalDeCalidad(place: SerpApiLocalPlace, query: string): boolean {
  const text = normalizarTexto(`${place.title ?? ""} ${place.type ?? ""} ${(place.types ?? []).join(" ")} ${place.address ?? ""}`);
  if (!place.title?.trim()) return false;
  if (LOW_QUALITY_LOCAL_TERMS.some((term) => text.includes(term))) return false;
  const rating = toNumber(place.rating);
  const reviews = toNumber(place.reviews);
  const hasKeyword = HIGH_QUALITY_NIGHTLIFE_TERMS.some((term) => text.includes(term) || normalizarTexto(query).includes(term));
  if (hasKeyword && (rating === null || rating >= 4.0) && (reviews === null || reviews >= 20)) return true;
  if ((rating ?? 0) >= 4.3 && (reviews ?? 0) >= 80) return true;
  if ((rating ?? 0) >= 4.1 && (reviews ?? 0) >= 250) return true;
  return false;
}

function mapSerpApiLocalPlace(place: SerpApiLocalPlace, city: string, provider: "google_local" | "google_maps", query: string, index: number): LiveEvent {
  const categoria = place.type || place.types?.[0] || "Plan local";
  const rating = toNumber(place.rating);
  const reviews = toNumber(place.reviews);
  const descripcion = [
    place.description?.trim(),
    rating ? `${rating.toFixed(1)}★` : null,
    reviews ? `${reviews} reseñas` : null,
    place.hours ? `Horario: ${place.hours}` : null,
  ].filter(Boolean).join(" · ") || `Plan local seleccionado para ${city}.`;
  const url = place.website?.trim() || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.title ?? query} ${city}`)}`;
  return {
    id: `${provider}_${normalizarTexto(`${place.place_id || place.data_id || place.title || query}_${index}`).replace(/\s+/g, "_").slice(0, 140)}`,
    provider,
    nombre: place.title?.trim() || "Plan local",
    descripcion,
    categoria: provider === "google_maps" ? `Plan local · ${categoria}` : `Ocio local · ${categoria}`,
    fechaInicio: new Date().toISOString(),
    fechaFin: null,
    ciudad: city,
    recinto: place.title?.trim() || null,
    direccion: place.address?.trim() || null,
    latitud: toNumber(place.gps_coordinates?.latitude),
    longitud: toNumber(place.gps_coordinates?.longitude),
    imagen: place.thumbnail?.trim() || null,
    url,
    score: scoreLocalPlace(place, query),
  };
}

async function fetchSerpApiEvents(params: {
  city: string;
  from: string;
  to: string;
  category?: string | null;
}): Promise<LiveEvent[]> {
  if (!env.SERPAPI_API_KEY) return [];

  try {
    const keyword = buildGoogleEventsKeyword(params.city, params.category);
    const q = `${keyword} del ${params.from} al ${params.to}`;
    const response = await axios.get("https://serpapi.com/search.json", {
      params: {
        engine: "google_events",
        q,
        hl: "es",
        gl: "es",
        api_key: env.SERPAPI_API_KEY,
      },
      timeout: env.EVENTS_LIVE_TIMEOUT_MS,
    });

    const events = Array.isArray(response.data?.events_results)
      ? response.data.events_results
      : [];

    return events.map((event: SerpApiEvent, index: number) =>
      mapSerpApiEvent(event, params.city, index),
    );
  } catch (error) {
    console.error("Error SerpApi Google Events:", error);
    return [];
  }
}


async function fetchSerpApiLocalPlans(params: {
  city: string;
  category?: string | null;
  provider: "google_local" | "google_maps";
}): Promise<LiveEvent[]> {
  if (!env.SERPAPI_API_KEY) return [];
  if (!esCategoriaPlanesLocales(params.category)) return [];

  const queries = buildLocalPlanQueries(params.city, params.category);
  const results: LiveEvent[] = [];

  for (const query of queries) {
    try {
      const response = await axios.get("https://serpapi.com/search.json", {
        params: {
          engine: params.provider === "google_maps" ? "google_maps" : "google_local",
          q: query,
          hl: "es",
          gl: "es",
          api_key: env.SERPAPI_API_KEY,
        },
        timeout: env.EVENTS_LIVE_TIMEOUT_MS,
      });

      const localResults: SerpApiLocalPlace[] = Array.isArray(response.data?.local_results)
        ? response.data.local_results
        : [];
      const placeResults: SerpApiLocalPlace[] = response.data?.place_results ? [response.data.place_results] : [];
      const places = [...localResults, ...placeResults]
        .filter((place) => esPlanLocalDeCalidad(place, query))
        .map((place, index) => mapSerpApiLocalPlace(place, params.city, params.provider, query, index));
      results.push(...places);
    } catch (error) {
      console.error(`Error SerpApi ${params.provider}:`, error);
    }
  }

  return results;
}

async function executeAttempt(params: {
  city: string;
  latitud: number | null;
  longitud: number | null;
  attempt: SearchAttempt;
  category?: string | null;
}) {
  const [ticketmasterEvents, predictHQEvents, serpApiEvents, googleLocalEvents, googleMapsEvents] = await Promise.all([
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
    fetchSerpApiEvents({
      city: params.city,
      from: params.attempt.from,
      to: params.attempt.to,
      category: params.category,
    }),
    fetchSerpApiLocalPlans({ city: params.city, category: params.category, provider: "google_local" }),
    fetchSerpApiLocalPlans({ city: params.city, category: params.category, provider: "google_maps" }),
  ]);

  const datedEvents = filtrarPorFechas(
    [...ticketmasterEvents, ...predictHQEvents, ...serpApiEvents],
    params.attempt.from,
    params.attempt.to,
  );

  const merged = enriquecerYFiltrarEventos([
    ...datedEvents,
    ...googleLocalEvents,
    ...googleMapsEvents,
  ]);

  return {
    events: merged,
    providers: {
      ticketmaster: ticketmasterEvents.length,
      predicthq: predictHQEvents.length,
      serpapi: serpApiEvents.length,
      google_local: googleLocalEvents.length,
      google_maps: googleMapsEvents.length,
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

function buildWarnings(): string[] {
  const warnings: string[] = [];

  if (!env.TICKETMASTER_API_KEY) {
    warnings.push("Ticketmaster no está configurado.");
  }

  if (!env.PREDICTHQ_API_KEY) {
    warnings.push("PredictHQ no está configurado.");
  }

  if (!env.SERPAPI_API_KEY) {
    warnings.push("SerpApi no está configurado.");
  }

  return warnings;
}

export async function buscarEventosLiveAgregado(params: {
  city: string;
  from: string;
  to: string;
  lat?: number | null;
  lng?: number | null;
  radiusKm?: number | null;
  category?: string | null;
}): Promise<EventosLiveAgregadoResponse> {
  const city = params.city.trim();
  const from = params.from.trim();
  const to = params.to.trim();

  if (!city || !from || !to) {
    return {
      city,
      from,
      to,
      coordenadas: { latitud: null, longitud: null },
      search_strategy: {
        success_attempt: null,
        success_label: null,
        requested_radius_km: 0,
        used_from: null,
        used_to: null,
        used_radius_km: null,
        attempted: [],
      },
      message: "Parámetros obligatorios: city, from, to",
      providers: { ticketmaster: 0, predicthq: 0, serpapi: 0, google_local: 0, google_maps: 0 },
      total: 0,
      events: [],
      warnings: ["Parámetros obligatorios: city, from, to"],
    };
  }

  let latitud = params.lat ?? null;
  let longitud = params.lng ?? null;

  if (latitud === null || longitud === null) {
    const coords = await resolverCoordenadasCiudad(city);
    latitud = coords.latitud;
    longitud = coords.longitud;
  }

  const requestedRadiusKm = clamp(
    params.radiusKm ?? env.PREDICTHQ_RADIUS_KM,
    20,
    80,
  );

  const attempts = buildAttempts(from, to, requestedRadiusKm);
  const warnings = buildWarnings();

  const tried: EventosLiveAgregadoResponse["search_strategy"]["attempted"] = [];

  for (const attempt of attempts) {
    const result = await executeAttempt({
      city,
      latitud,
      longitud,
      attempt,
      category: params.category ?? null,
    });

    tried.push({
      code: attempt.code,
      label: attempt.label,
      from: attempt.from,
      to: attempt.to,
      radiusKm: attempt.radiusKm,
      ticketmaster: result.providers.ticketmaster,
      predicthq: result.providers.predicthq,
      serpapi: result.providers.serpapi,
      google_local: result.providers.google_local,
      google_maps: result.providers.google_maps,
      total: result.events.length,
    });

    if (result.events.length > 0) {
      return {
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
        warnings,
      };
    }
  }

  return {
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
      serpapi: 0,
    },
    total: 0,
    events: [],
    warnings,
  };
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
      category?: string;
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

    const result = await buscarEventosLiveAgregado({
      city,
      from,
      to,
      lat: toNumber(query.lat),
      lng: toNumber(query.lng),
      radiusKm: toNumber(query.radiusKm),
      category: query.category ?? null,
    });

    return reply.send(result);
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

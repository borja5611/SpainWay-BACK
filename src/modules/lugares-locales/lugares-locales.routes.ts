import { FastifyInstance } from "fastify";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";

type FuenteLocal = "all" | "google_local" | "google_maps" | "tripadvisor" | "cache";
type TipoLocal =
  | "comer_bien"
  | "cenar"
  | "tapas"
  | "cafe_brunch"
  | "tipico_local"
  | "rapido"
  | "restaurante"
  | "todos";

type LugarLocal = {
  id: string;
  externalId: string;
  provider: "google_local" | "google_maps" | "tripadvisor" | "cache";
  fuente: string;
  nombre: string;
  categoria: string | null;
  direccion: string | null;
  ciudad: string | null;
  latitud: number | null;
  longitud: number | null;
  rating: number | null;
  reviews: number | null;
  precio: string | null;
  telefono: string | null;
  descripcion: string | null;
  imagen: string | null;
  url: string | null;
  googleUrl: string;
  directionsUrl: string;
  score: number;
};

type ProviderResult = {
  provider: string;
  enabled: boolean;
  warning?: string | null;
  items: LugarLocal[];
};

function normalizarTexto(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || ["nan", "null", "undefined", "none"].includes(text.toLowerCase())) return null;
  return text;
}

function googleSearchUrl(nombre: string, ciudad?: string | null, direccion?: string | null): string {
  const query = [nombre, direccion, ciudad, "España"].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function googleDirectionsUrl(input: {
  nombre: string;
  ciudad?: string | null;
  direccion?: string | null;
  latitud?: number | null;
  longitud?: number | null;
}): string {
  const destination =
    input.latitud !== null &&
    input.latitud !== undefined &&
    input.longitud !== null &&
    input.longitud !== undefined
      ? `${input.latitud},${input.longitud}`
      : [input.nombre, input.direccion, input.ciudad, "España"].filter(Boolean).join(", ");

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

function tipoToQuery(tipo: TipoLocal, ciudad: string): string {
  const map: Record<TipoLocal, string> = {
    todos: `restaurantes en ${ciudad}`,
    restaurante: `restaurantes en ${ciudad}`,
    comer_bien: `mejores restaurantes en ${ciudad}`,
    cenar: `restaurantes para cenar en ${ciudad}`,
    tapas: `bares de tapas en ${ciudad}`,
    cafe_brunch: `cafeterías brunch en ${ciudad}`,
    tipico_local: `restaurantes comida típica local en ${ciudad}`,
    rapido: `comida rápida buena en ${ciudad}`,
  };
  return map[tipo] ?? map.todos;
}

function categoriaFromTipo(tipo: TipoLocal): string {
  const map: Record<TipoLocal, string> = {
    todos: "Restauración",
    restaurante: "Restaurante",
    comer_bien: "Restaurante recomendado",
    cenar: "Cena",
    tapas: "Tapas",
    cafe_brunch: "Café / brunch",
    tipico_local: "Típico local",
    rapido: "Comida rápida",
  };
  return map[tipo] ?? "Restauración";
}

function isFoodCandidate(nombre: string, categoria?: string | null): boolean {
  const raw = normalizarTexto(`${nombre} ${categoria ?? ""}`);
  const blocked = [
    "museo",
    "museum",
    "monumento",
    "monument",
    "iglesia",
    "church",
    "hotel",
    "parking",
    "aparcamiento",
    "universidad",
    "school",
    "tienda",
    "store",
    "shop",
    "cine",
    "cinema",
    "teatro",
    "theater",
  ];
  if (blocked.some((word) => raw.includes(word))) return false;

  const allowed = [
    "restaurant",
    "restaurante",
    "bar",
    "tapas",
    "taberna",
    "bodega",
    "cafe",
    "cafeteria",
    "coffee",
    "brunch",
    "bakery",
    "pasteleria",
    "pizza",
    "pizzeria",
    "burger",
    "food",
    "comida",
    "cocina",
    "gastronomia",
    "gastro",
    "grill",
    "asador",
    "arroceria",
    "marisqueria",
  ];

  return allowed.some((word) => raw.includes(word)) || categoria === null;
}

function scoreLugar(item: LugarLocal): number {
  let score = 50;
  if (item.rating) score += Math.min(25, item.rating * 5);
  if (item.reviews) score += Math.min(14, Math.log10(item.reviews + 1) * 5);
  if (item.latitud !== null && item.longitud !== null) score += 8;
  if (item.direccion) score += 5;
  if (item.imagen) score += 4;
  if (item.url) score += 3;
  if (item.provider === "google_local") score += 5;
  if (item.provider === "google_maps") score += 4;
  if (item.provider === "tripadvisor") score += 3;
  return Math.round(score);
}

function buildLugar(input: Omit<LugarLocal, "id" | "googleUrl" | "directionsUrl" | "score">): LugarLocal | null {
  const nombre = clean(input.nombre);
  if (!nombre) return null;

  const categoria = clean(input.categoria) ?? "Restauración";
  if (!isFoodCandidate(nombre, categoria)) return null;

  const latitud = toNumber(input.latitud);
  const longitud = toNumber(input.longitud);
  const direccion = clean(input.direccion);
  const ciudad = clean(input.ciudad);

  const base = {
    ...input,
    nombre,
    categoria,
    direccion,
    ciudad,
    latitud,
    longitud,
    rating: toNumber(input.rating),
    reviews: toNumber(input.reviews),
    precio: clean(input.precio),
    telefono: clean(input.telefono),
    descripcion: clean(input.descripcion),
    imagen: clean(input.imagen),
    url: clean(input.url),
  };

  const id = `${base.provider}_${normalizarTexto(`${base.externalId || nombre}_${direccion || ciudad || ""}`)
    .replace(/\s+/g, "_")
    .slice(0, 140)}`;

  const lugar: LugarLocal = {
    ...base,
    id,
    googleUrl: googleSearchUrl(nombre, ciudad, direccion),
    directionsUrl: googleDirectionsUrl({ nombre, ciudad, direccion, latitud, longitud }),
    score: 0,
  };

  lugar.score = scoreLugar(lugar);
  return lugar;
}

function parseAddress(value: unknown): string | null {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).join(", ") || null;
  return clean(value);
}

function getLatLngFromGps(gps: unknown): { lat: number | null; lon: number | null } {
  if (!gps || typeof gps !== "object") return { lat: null, lon: null };
  const obj = gps as Record<string, unknown>;
  return {
    lat: toNumber(obj.latitude ?? obj.lat),
    lon: toNumber(obj.longitude ?? obj.lng ?? obj.lon),
  };
}

async function fetchJson(url: URL, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${response.status} ${detail.slice(0, 180)}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function buscarGoogleLocal(params: {
  ciudad: string;
  tipo: TipoLocal;
  limit: number;
}): Promise<ProviderResult> {
  if (!env.SERPAPI_API_KEY) {
    return { provider: "google_local", enabled: false, items: [], warning: "SerpApi no está configurado." };
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_local");
  url.searchParams.set("q", tipoToQuery(params.tipo, params.ciudad));
  url.searchParams.set("location", `${params.ciudad}, España`);
  url.searchParams.set("google_domain", "google.es");
  url.searchParams.set("gl", "es");
  url.searchParams.set("hl", "es");
  url.searchParams.set("api_key", env.SERPAPI_API_KEY);

  try {
    const data = (await fetchJson(url, env.SERPAPI_TIMEOUT_MS)) as any;
    const results = Array.isArray(data.local_results) ? data.local_results : [];

    const items = results
      .slice(0, params.limit)
      .map((item: any, index: number) => {
        const gps = getLatLngFromGps(item.gps_coordinates);
        return buildLugar({
          provider: "google_local",
          fuente: "Google Local",
          externalId: clean(item.place_id ?? item.data_id ?? item.cid ?? item.position ?? index) ?? String(index),
          nombre: clean(item.title ?? item.name) ?? "Restaurante",
          categoria: clean(item.type ?? item.category) ?? categoriaFromTipo(params.tipo),
          direccion: parseAddress(item.address),
          ciudad: params.ciudad,
          latitud: gps.lat,
          longitud: gps.lon,
          rating: toNumber(item.rating),
          reviews: toNumber(item.reviews),
          precio: clean(item.price),
          telefono: clean(item.phone),
          descripcion: clean(item.description ?? item.snippet),
          imagen: clean(item.thumbnail),
          url: clean(item.website ?? item.link),
        });
      })
      .filter(Boolean) as LugarLocal[];

    return { provider: "google_local", enabled: true, items };
  } catch (error) {
    return {
      provider: "google_local",
      enabled: true,
      items: [],
      warning: `Google Local no respondió correctamente: ${error instanceof Error ? error.message : "error desconocido"}`,
    };
  }
}

async function buscarGoogleMaps(params: {
  ciudad: string;
  tipo: TipoLocal;
  lat?: number | null;
  lon?: number | null;
  radiusKm: number;
  limit: number;
}): Promise<ProviderResult> {
  if (!env.SERPAPI_API_KEY) {
    return { provider: "google_maps", enabled: false, items: [], warning: "SerpApi no está configurado." };
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("type", "search");
  url.searchParams.set("q", tipoToQuery(params.tipo, params.ciudad));
  url.searchParams.set("google_domain", "google.es");
  url.searchParams.set("gl", "es");
  url.searchParams.set("hl", "es");
  if (params.lat !== null && params.lat !== undefined && params.lon !== null && params.lon !== undefined) {
    url.searchParams.set("ll", `@${params.lat},${params.lon},14z`);
  }
  url.searchParams.set("api_key", env.SERPAPI_API_KEY);

  try {
    const data = (await fetchJson(url, env.SERPAPI_TIMEOUT_MS)) as any;
    const results = Array.isArray(data.local_results) ? data.local_results : [];

    const items = results
      .slice(0, params.limit)
      .map((item: any, index: number) => {
        const gps = getLatLngFromGps(item.gps_coordinates);
        return buildLugar({
          provider: "google_maps",
          fuente: "Google Maps",
          externalId: clean(item.place_id ?? item.data_id ?? item.position ?? index) ?? String(index),
          nombre: clean(item.title ?? item.name) ?? "Restaurante",
          categoria: clean(item.type ?? item.category) ?? categoriaFromTipo(params.tipo),
          direccion: parseAddress(item.address),
          ciudad: params.ciudad,
          latitud: gps.lat,
          longitud: gps.lon,
          rating: toNumber(item.rating),
          reviews: toNumber(item.reviews),
          precio: clean(item.price),
          telefono: clean(item.phone),
          descripcion: clean(item.description ?? item.snippet),
          imagen: clean(item.thumbnail),
          url: clean(item.website ?? item.link),
        });
      })
      .filter(Boolean) as LugarLocal[];

    return { provider: "google_maps", enabled: true, items };
  } catch (error) {
    return {
      provider: "google_maps",
      enabled: true,
      items: [],
      warning: `Google Maps no respondió correctamente: ${error instanceof Error ? error.message : "error desconocido"}`,
    };
  }
}

async function buscarTripadvisor(params: {
  ciudad: string;
  tipo: TipoLocal;
  limit: number;
}): Promise<ProviderResult> {
  if (!env.SERPAPI_API_KEY) {
    return { provider: "tripadvisor", enabled: false, items: [], warning: "SerpApi no está configurado." };
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "tripadvisor");
  url.searchParams.set("q", tipoToQuery(params.tipo, params.ciudad));
  url.searchParams.set("location", `${params.ciudad}, España`);
  url.searchParams.set("hl", "es");
  url.searchParams.set("api_key", env.SERPAPI_API_KEY);

  try {
    const data = (await fetchJson(url, env.SERPAPI_TIMEOUT_MS)) as any;
    const rawResults =
      data.results ??
      data.search_results ??
      data.tripadvisor_results ??
      data.places_results ??
      [];
    const results = Array.isArray(rawResults) ? rawResults : [];

    const items = results
      .slice(0, params.limit)
      .map((item: any, index: number) => {
        const gps = getLatLngFromGps(item.gps_coordinates ?? item.coordinates);
        return buildLugar({
          provider: "tripadvisor",
          fuente: "Tripadvisor",
          externalId: clean(item.location_id ?? item.id ?? item.place_id ?? item.position ?? index) ?? String(index),
          nombre: clean(item.title ?? item.name) ?? "Restaurante",
          categoria: clean(item.type ?? item.category ?? item.result_type) ?? categoriaFromTipo(params.tipo),
          direccion: parseAddress(item.address ?? item.location_string),
          ciudad: params.ciudad,
          latitud: gps.lat,
          longitud: gps.lon,
          rating: toNumber(item.rating),
          reviews: toNumber(item.reviews ?? item.num_reviews),
          precio: clean(item.price ?? item.price_level),
          telefono: clean(item.phone),
          descripcion: clean(item.description ?? item.snippet),
          imagen: clean(item.thumbnail ?? item.image),
          url: clean(item.link ?? item.url),
        });
      })
      .filter(Boolean) as LugarLocal[];

    return { provider: "tripadvisor", enabled: true, items };
  } catch (error) {
    return {
      provider: "tripadvisor",
      enabled: true,
      items: [],
      warning: `Tripadvisor no respondió correctamente: ${error instanceof Error ? error.message : "error desconocido"}`,
    };
  }
}

async function buscarCache(params: { ciudad: string; tipo: TipoLocal; limit: number }): Promise<ProviderResult> {
  try {
    const lugares = await prisma.lugarRestauracion.findMany({
      where: {
        OR: [
          { direccion: { contains: params.ciudad, mode: "insensitive" } },
          { nombre: { contains: params.ciudad, mode: "insensitive" } },
        ],
      },
      orderBy: [{ actualizadoEn: "desc" }],
      take: params.limit,
    });

    const items = lugares
      .map((item) =>
        buildLugar({
          provider: "cache",
          fuente: "SpainWay guardado",
          externalId: String(item.id_lugar_restauracion),
          nombre: item.nombre,
          categoria: item.categoria ?? categoriaFromTipo(params.tipo),
          direccion: item.direccion,
          ciudad: params.ciudad,
          latitud: item.latitud,
          longitud: item.longitud,
          rating: item.rating,
          reviews: null,
          precio: item.precio,
          telefono: item.telefono,
          descripcion: null,
          imagen: null,
          url: item.url,
        })
      )
      .filter(Boolean) as LugarLocal[];

    return { provider: "cache", enabled: true, items };
  } catch {
    return { provider: "cache", enabled: true, items: [], warning: "No se pudo consultar la caché local." };
  }
}

function deduplicate(items: LugarLocal[]): LugarLocal[] {
  const map = new Map<string, LugarLocal>();

  for (const item of items) {
    const key = normalizarTexto(`${item.nombre} ${item.ciudad ?? ""}`)
      .replace(/\b(restaurante|restaurant|bar|cafe|cafeteria|la|el|los|las|de|del)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!key) continue;
    const current = map.get(key);
    if (!current || item.score > current.score) map.set(key, item);
  }

  return Array.from(map.values()).sort((a, b) => b.score - a.score);
}

async function upsertCache(items: LugarLocal[]) {
  for (const item of items.slice(0, 12)) {
    if (item.latitud === null || item.longitud === null) continue;
    try {
      await prisma.lugarRestauracion.upsert({
        where: {
          proveedor_externalId: {
            proveedor: item.provider,
            externalId: item.externalId,
          },
        },
        update: {
          nombre: item.nombre,
          categoria: item.categoria,
          direccion: item.direccion,
          latitud: item.latitud,
          longitud: item.longitud,
          rating: item.rating,
          precio: item.precio,
          telefono: item.telefono,
          url: item.url ?? item.googleUrl,
        },
        create: {
          proveedor: item.provider,
          externalId: item.externalId,
          nombre: item.nombre,
          categoria: item.categoria,
          direccion: item.direccion,
          latitud: item.latitud,
          longitud: item.longitud,
          distancia: null,
          rating: item.rating,
          precio: item.precio,
          telefono: item.telefono,
          url: item.url ?? item.googleUrl,
        },
      });
    } catch {
      // No bloqueamos la respuesta por fallos de cacheo.
    }
  }
}

export default async function lugaresLocalesRoutes(app: FastifyInstance) {
  app.get("/buscar", async (request, reply) => {
    const query = request.query as {
      ciudad?: string;
      destino?: string;
      fecha?: string;
      tipo?: TipoLocal;
      fuente?: FuenteLocal;
      lat?: string;
      lon?: string;
      lng?: string;
      radiusKm?: string;
      limit?: string;
    };

    if (!env.LOCAL_SEARCH_ENABLED) {
      return reply.code(503).send({ ok: false, message: "La búsqueda local está desactivada." });
    }

    const ciudad = clean(query.ciudad ?? query.destino) ?? "";
    if (!ciudad) {
      return reply.code(400).send({ ok: false, message: "La ciudad es obligatoria." });
    }

    const tipo = query.tipo ?? "comer_bien";
    const fuente = query.fuente ?? "all";
    const limit = Math.min(Math.max(Number(query.limit ?? env.LOCAL_SEARCH_MAX_RESULTS), 4), 30);
    const lat = toNumber(query.lat);
    const lon = toNumber(query.lon ?? query.lng);
    const radiusKm = Math.min(Math.max(Number(query.radiusKm ?? 8), 1), 80);

    const providers: Array<Promise<ProviderResult>> = [];

    if (fuente === "all" || fuente === "google_local") {
      providers.push(buscarGoogleLocal({ ciudad, tipo, limit }));
    }

    if (fuente === "all" || fuente === "google_maps") {
      providers.push(buscarGoogleMaps({ ciudad, tipo, lat, lon, radiusKm, limit }));
    }

    if (fuente === "all" || fuente === "tripadvisor") {
      providers.push(buscarTripadvisor({ ciudad, tipo, limit }));
    }

    if (fuente === "all" || fuente === "cache") {
      providers.push(buscarCache({ ciudad, tipo, limit }));
    }

    const settled = await Promise.allSettled(providers);
    const providerResults = settled.map((result): ProviderResult => {
      if (result.status === "fulfilled") return result.value;
      return {
        provider: "unknown",
        enabled: true,
        items: [],
        warning: "Una fuente local no respondió correctamente.",
      };
    });

    const warnings = providerResults.flatMap((result) => (result.warning ? [result.warning] : []));
    const items = deduplicate(providerResults.flatMap((result) => result.items)).slice(0, limit);
    void upsertCache(items);

    return {
      ok: true,
      ciudad,
      fecha: clean(query.fecha),
      tipo,
      fuente,
      total: items.length,
      providers: Object.fromEntries(providerResults.map((result) => [result.provider, result.items.length])),
      fuentes_usadas: providerResults.filter((result) => result.enabled).map((result) => result.provider),
      warnings,
      items,
    };
  });
}

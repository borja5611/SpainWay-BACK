import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

type Momento = "desayuno" | "comida" | "cena" | "cafe";

type Tipo =
  | "todos"
  | "restaurante"
  | "tapas"
  | "cafeteria"
  | "bar"
  | "fast_food"
  | "pasteleria";

type OrdenRestauracion = "recomendado" | "cercania" | "contacto";
type PresupuestoEstimado = "todos" | "bajo" | "medio" | "alto";

type RestauranteExterno = {
  proveedor: string;
  externalId: string;
  nombre: string;
  categoria: string | null;
  direccion: string | null;
  latitud: number;
  longitud: number;
  distancia: number;
  telefono: string | null;
  website: string | null;
  presupuestoEstimado: PresupuestoEstimado;
};

const CATEGORIAS_FSQ: Record<Tipo, string> = {
  todos: "13000",
  restaurante: "13065",
  tapas: "13354",
  cafeteria: "13032",
  bar: "13003",
  fast_food: "13145",
  pasteleria: "13040",
};

const OSM_AMENITY: Record<Tipo, string[]> = {
  todos: ["restaurant", "cafe", "bar", "pub", "fast_food", "bakery"],
  restaurante: ["restaurant"],
  tapas: ["restaurant", "bar", "pub"],
  cafeteria: ["cafe"],
  bar: ["bar", "pub"],
  fast_food: ["fast_food"],
  pasteleria: ["bakery", "cafe"],
};

const QUERY_FSQ: Record<Tipo, string[]> = {
  todos: ["restaurant", "tapas", "cafe", "bar"],
  restaurante: ["restaurant", "restaurante", "italian restaurant", "spanish restaurant"],
  tapas: ["tapas", "taberna", "bodega", "bar de tapas"],
  cafeteria: ["cafe", "coffee", "cafeteria", "brunch"],
  bar: ["bar", "pub", "tapas bar"],
  fast_food: ["fast food", "burger", "pizza", "kebab"],
  pasteleria: ["bakery", "pasteleria", "pastry", "cafe"],
};

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function googleSearchUrl(nombre: string, direccion?: string | null) {
  const query = [nombre, direccion].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function haversineMetros(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
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

function construirDireccion(item: any): string | null {
  const fromLocation =
    item.location?.formatted_address ??
    item.location?.address ??
    item.formatted ??
    item.address_line1 ??
    item.address ??
    null;

  if (fromLocation) return fromLocation;

  const direccion = [
    item.address,
    item.locality,
    item.region,
    item.postcode,
    item.country,
  ]
    .filter(Boolean)
    .join(", ");

  return direccion || null;
}

function extraerCategoria(item: any): string {
  return (
    item.categories?.[0]?.name ??
    item.fsq_category_labels?.[0]?.split(" > ").pop() ??
    item.properties?.categories?.[0] ??
    item.properties?.datasource?.raw?.amenity ??
    "Restauración"
  );
}

function extraerLatitud(item: any): number | null {
  return toNumber(
    item.latitude ??
      item.geocodes?.main?.latitude ??
      item.location?.latitude ??
      item.properties?.lat ??
      item.lat
  );
}

function extraerLongitud(item: any): number | null {
  return toNumber(
    item.longitude ??
      item.geocodes?.main?.longitude ??
      item.location?.longitude ??
      item.properties?.lon ??
      item.lon
  );
}

function extraerExternalId(item: any): string | null {
  return item.fsq_place_id ?? item.fsq_id ?? item.id ?? item.properties?.place_id ?? null;
}

function estimarPresupuesto(categoria?: string | null, nombre?: string | null): PresupuestoEstimado {
  const raw = normalizarTexto(`${categoria ?? ""} ${nombre ?? ""}`);

  if (
    raw.includes("fast") ||
    raw.includes("burger") ||
    raw.includes("kebab") ||
    raw.includes("pizza") ||
    raw.includes("bakery") ||
    raw.includes("pasteler") ||
    raw.includes("cafe") ||
    raw.includes("coffee") ||
    raw.includes("bar") ||
    raw.includes("taberna") ||
    raw.includes("bodega")
  ) {
    return "bajo";
  }

  if (
    raw.includes("fine") ||
    raw.includes("gourmet") ||
    raw.includes("grill") ||
    raw.includes("steak") ||
    raw.includes("marisqueria")
  ) {
    return "alto";
  }

  return "medio";
}

function esCandidatoComida(item: { nombre: string; categoria: string | null; tipo: Tipo }) {
  const raw = normalizarTexto(`${item.nombre} ${item.categoria ?? ""}`);

  const bloqueados = [
    "museum",
    "museo",
    "science museum",
    "history museum",
    "teatro",
    "theater",
    "mobile phone",
    "phone store",
    "tienda",
    "store",
    "shop",
    "monument",
    "monumento",
    "tourist attraction",
    "atraccion turistica",
    "plaza",
    "park",
    "parque",
    "church",
    "iglesia",
    "school",
    "universidad",
    "hotel",
    "hostel",
    "hostal",
    "apartment",
    "parking",
    "night club",
    "discoteca",
    "cinema",
    "cine",
  ];

  if (bloqueados.some((word) => raw.includes(word))) return false;

  const permitidos = [
    "restaurant",
    "restaurante",
    "trattoria",
    "tapas",
    "taberna",
    "bodega",
    "bar",
    "cafe",
    "cafeteria",
    "coffee",
    "bakery",
    "pasteleria",
    "pastry",
    "pizza",
    "pizzeria",
    "burger",
    "hamburger",
    "fast food",
    "kebab",
    "sushi",
    "italian",
    "spanish",
    "mediterranean",
    "andalusian",
    "food",
    "comida",
    "brunch",
    "breakfast",
  ];

  if (!permitidos.some((word) => raw.includes(word))) return false;

  if (item.tipo === "restaurante") {
    return [
      "restaurant",
      "restaurante",
      "trattoria",
      "italian",
      "spanish",
      "mediterranean",
      "tapas",
    ].some((word) => raw.includes(word));
  }

  if (item.tipo === "tapas") {
    return ["tapas", "taberna", "bodega", "bar", "spanish", "andalusian", "restaurant", "restaurante"].some((word) =>
      raw.includes(word)
    );
  }

  if (item.tipo === "cafeteria") {
    return ["cafe", "cafeteria", "coffee", "bakery", "pasteleria", "brunch", "breakfast"].some((word) =>
      raw.includes(word)
    );
  }

  if (item.tipo === "bar") {
    return ["bar", "pub", "tapas", "taberna", "bodega"].some((word) => raw.includes(word));
  }

  if (item.tipo === "fast_food") {
    return ["fast food", "burger", "hamburger", "pizza", "kebab", "sandwich"].some((word) =>
      raw.includes(word)
    );
  }

  if (item.tipo === "pasteleria") {
    return ["bakery", "pasteleria", "pastry", "cafe", "coffee"].some((word) => raw.includes(word));
  }

  return true;
}

function scoreRestaurante(input: {
  distancia?: number | null;
  momento: Momento;
  categoria?: string | null;
  nombre?: string | null;
  telefono?: string | null;
  website?: string | null;
  presupuestoSeleccionado: PresupuestoEstimado;
  presupuestoEstimado: PresupuestoEstimado;
  tipo: Tipo;
}) {
  const distancia = input.distancia ?? 9999;
  const raw = normalizarTexto(`${input.nombre ?? ""} ${input.categoria ?? ""}`);

  let score = 55;

  score += Math.max(0, 35 - distancia / 45);

  if (input.telefono) score += 6;
  if (input.website) score += 8;

  if (input.presupuestoSeleccionado !== "todos") {
    score += input.presupuestoSeleccionado === input.presupuestoEstimado ? 16 : -4;
  }

  if (input.momento === "desayuno" || input.momento === "cafe") {
    if (["cafe", "coffee", "bakery", "pasteleria", "brunch", "breakfast"].some((w) => raw.includes(w))) {
      score += 22;
    }
  }

  if (input.momento === "comida" || input.momento === "cena") {
    if (["restaurant", "restaurante", "tapas", "taberna", "bodega", "bar", "spanish", "mediterranean"].some((w) => raw.includes(w))) {
      score += 22;
    }
  }

  if (input.tipo !== "todos") {
    if (esCandidatoComida({ nombre: input.nombre ?? "", categoria: input.categoria ?? "", tipo: input.tipo })) {
      score += 14;
    }
  }

  if (raw.includes("museum") || raw.includes("museo") || raw.includes("store") || raw.includes("tienda")) {
    score -= 100;
  }

  return Math.round(score);
}

function claveDuplicado(item: RestauranteExterno) {
  const nombre = normalizarTexto(item.nombre)
    .replace(/\b(restaurante|restaurant|bar|cafe|cafeteria|taberna|bodega|casa|la|el|los|las)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const zona = item.direccion ? normalizarTexto(item.direccion).slice(0, 28) : "";
  return `${nombre}-${zona}`;
}

function quitarDuplicados(items: RestauranteExterno[]) {
  const map = new Map<string, RestauranteExterno>();

  for (const item of items) {
    const key = claveDuplicado(item);
    if (!key.trim()) continue;

    const existente = map.get(key);
    if (!existente) {
      map.set(key, item);
      continue;
    }

    const itemTieneContacto = item.telefono || item.website ? 1 : 0;
    const existenteTieneContacto = existente.telefono || existente.website ? 1 : 0;

    if (
      itemTieneContacto > existenteTieneContacto ||
      (itemTieneContacto === existenteTieneContacto && item.distancia < existente.distancia)
    ) {
      map.set(key, item);
    }
  }

  return Array.from(map.values());
}

async function buscarFoursquareUnaVez(params: {
  lat: number;
  lng: number;
  radio: number;
  tipo: Tipo;
  limit: number;
  query?: string;
}) {
  const apiKey = process.env.FSQ_API_KEY;
  if (!apiKey) return [];

  const url = new URL("https://places-api.foursquare.com/places/search");
  url.searchParams.set("ll", `${params.lat},${params.lng}`);
  url.searchParams.set("radius", String(params.radio));
  url.searchParams.set("limit", String(params.limit));
  url.searchParams.set("categories", CATEGORIAS_FSQ[params.tipo] ?? CATEGORIAS_FSQ.todos);

  if (params.query) {
    url.searchParams.set("query", params.query);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "X-Places-Api-Version": "2025-06-17",
      },
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("Foursquare falló:", response.status, detail);
      return [];
    }

    const data = (await response.json()) as any;
    const results = Array.isArray(data.results) ? data.results : [];

    return results
      .map((item: any): RestauranteExterno | null => {
        const latitud = extraerLatitud(item);
        const longitud = extraerLongitud(item);
        const externalId = extraerExternalId(item);

        if (latitud === null || longitud === null || !externalId) return null;

        const categoria = extraerCategoria(item);
        const direccion = construirDireccion(item);
        const nombre = item.name ?? "Lugar sin nombre";
        const distancia =
          typeof item.distance === "number"
            ? item.distance
            : haversineMetros(params.lat, params.lng, latitud, longitud);

        return {
          proveedor: "foursquare",
          externalId,
          nombre,
          categoria,
          direccion,
          latitud,
          longitud,
          distancia,
          telefono: item.tel ?? null,
          website: item.website ?? null,
          presupuestoEstimado: estimarPresupuesto(categoria, nombre),
        };
      })
      .filter(Boolean) as RestauranteExterno[];
  } catch (error) {
    console.error("Foursquare terminó con error:", error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function buscarFoursquare(params: {
  lat: number;
  lng: number;
  radio: number;
  tipo: Tipo;
  limit: number;
}) {
  const queries = QUERY_FSQ[params.tipo] ?? QUERY_FSQ.todos;
  const acumulado: RestauranteExterno[] = [];

  const base = await buscarFoursquareUnaVez({
    ...params,
    limit: params.limit,
  });

  acumulado.push(...base);

  for (const query of queries.slice(0, 3)) {
    const parcial = await buscarFoursquareUnaVez({
      ...params,
      limit: Math.max(8, Math.floor(params.limit / 2)),
      query,
    });

    acumulado.push(...parcial);
  }

  return quitarDuplicados(acumulado);
}

async function buscarOpenStreetMap(params: {
  lat: number;
  lng: number;
  radio: number;
  tipo: Tipo;
  limit: number;
}) {
  const amenities = OSM_AMENITY[params.tipo] ?? OSM_AMENITY.todos;

  const filtros = amenities
    .map(
      (amenity) => `
        node["amenity"="${amenity}"](around:${params.radio},${params.lat},${params.lng});
        way["amenity"="${amenity}"](around:${params.radio},${params.lat},${params.lng});
        relation["amenity"="${amenity}"](around:${params.radio},${params.lat},${params.lng});
      `
    )
    .join("\n");

  const query = `
    [out:json][timeout:12];
    (
      ${filtros}
    );
    out center ${params.limit};
  `;

  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "SpainWay-TFG/1.0",
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("OpenStreetMap falló:", response.status, detail);
      return [];
    }

    const data = (await response.json()) as any;
    const elements = Array.isArray(data.elements) ? data.elements : [];

    return elements
      .map((item: any): RestauranteExterno | null => {
        const latitud = item.lat ?? item.center?.lat;
        const longitud = item.lon ?? item.center?.lon;

        if (!latitud || !longitud) return null;

        const nombre = item.tags?.name;
        if (!nombre) return null;

        const amenity = item.tags?.amenity ?? "restaurant";

        const direccion = [
          item.tags?.["addr:street"],
          item.tags?.["addr:housenumber"],
          item.tags?.["addr:city"],
        ]
          .filter(Boolean)
          .join(", ");

        return {
          proveedor: "openstreetmap",
          externalId: String(item.id),
          nombre,
          categoria: amenity,
          direccion: direccion || null,
          latitud,
          longitud,
          distancia: haversineMetros(params.lat, params.lng, latitud, longitud),
          telefono: item.tags?.phone ?? item.tags?.["contact:phone"] ?? null,
          website: item.tags?.website ?? item.tags?.["contact:website"] ?? null,
          presupuestoEstimado: estimarPresupuesto(amenity, nombre),
        };
      })
      .filter(Boolean)
      .slice(0, params.limit) as RestauranteExterno[];
  } catch (error) {
    console.error("OpenStreetMap terminó con error:", error);
    return [];
  }
}

async function buscarGeoapify(params: {
  lat: number;
  lng: number;
  radio: number;
  limit: number;
}) {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) return [];

  const categorias = [
    "catering.restaurant",
    "catering.cafe",
    "catering.bar",
    "catering.pub",
    "catering.fast_food",
  ];

  const url = new URL("https://api.geoapify.com/v2/places");

  url.searchParams.set("categories", categorias.join(","));
  url.searchParams.set("filter", `circle:${params.lng},${params.lat},${params.radio}`);
  url.searchParams.set("bias", `proximity:${params.lng},${params.lat}`);
  url.searchParams.set("limit", String(params.limit));
  url.searchParams.set("apiKey", apiKey);

  try {
    const response = await fetch(url.toString());

    if (!response.ok) {
      const text = await response.text();
      console.error("Geoapify falló:", response.status, text);
      return [];
    }

    const data = await response.json();

    return (data.features || []).map((item: any) => {
      const props = item.properties;

      return {
        proveedor: "geoapify",
        externalId: props.place_id,
        nombre: props.name || "Lugar",
        categoria: props.categories?.[0] || "restaurante",
        direccion: props.formatted || null,
        latitud: props.lat,
        longitud: props.lon,
        distancia: props.distance || 0,
        telefono: props.phone || null,
        website: props.website || null,
        presupuestoEstimado: estimarPresupuesto(props.categories?.[0], props.name),
      };
    });
  } catch (error) {
    console.error("Geoapify error:", error);
    return [];
  }
}

export default async function restauracionRoutes(app: FastifyInstance) {
  app.get("/buscar", async (request, reply) => {
    const query = request.query as {
      lat?: string;
      lng?: string;
      radio?: string;
      momento?: Momento;
      tipo?: Tipo;
      limit?: string;
      presupuesto?: PresupuestoEstimado;
      soloConContacto?: string;
      orden?: OrdenRestauracion;
    };

    const lat = toNumber(query.lat);
    const lng = toNumber(query.lng);
    const radio = Math.min(Math.max(Number(query.radio ?? 1200), 300), 3000);
    const momento = query.momento ?? "comida";
    const tipo = query.tipo ?? "todos";
    const limit = Math.min(Math.max(Number(query.limit ?? 16), 4), 30);
    const presupuesto = query.presupuesto ?? "todos";
    const soloConContacto = query.soloConContacto === "true";
    const orden = query.orden ?? "recomendado";

    if (lat === null || lng === null) {
      return reply.code(400).send({ message: "lat y lng son obligatorios" });
    }

    const fsqResults = await buscarFoursquare({ lat, lng, radio, tipo, limit: 36 });

    const geoResults =
      fsqResults.length < 12
        ? await buscarGeoapify({ lat, lng, radio, limit: 20 })
        : [];

    const osmResults =
      fsqResults.length < 8
        ? await buscarOpenStreetMap({ lat, lng, radio, tipo, limit: 20 })
        : [];

    const externosBase = quitarDuplicados([
      ...fsqResults,
      ...geoResults,
      ...osmResults,
    ]);
    let candidatos = externosBase.filter((item) =>
      esCandidatoComida({
        nombre: item.nombre,
        categoria: item.categoria,
        tipo,
      })
    );

    if (candidatos.length < 4) {
      candidatos = externosBase.filter((item) =>
        esCandidatoComida({
          nombre: item.nombre,
          categoria: item.categoria,
          tipo: "todos",
        })
      );
    }

    if (soloConContacto) {
      const conContacto = candidatos.filter((item) => item.telefono || item.website);
      if (conContacto.length >= 4) {
        candidatos = conContacto;
      }
    }

    const enriquecidos = [];

    for (const item of candidatos) {
      const score = scoreRestaurante({
        distancia: item.distancia,
        momento,
        categoria: item.categoria,
        nombre: item.nombre,
        telefono: item.telefono,
        website: item.website,
        presupuestoSeleccionado: presupuesto,
        presupuestoEstimado: item.presupuestoEstimado,
        tipo,
      });

      if (score < 20) continue;

      const lugar = await prisma.lugarRestauracion.upsert({
        where: {
          proveedor_externalId: {
            proveedor: item.proveedor,
            externalId: item.externalId,
          },
        },
        update: {
          nombre: item.nombre,
          categoria: item.categoria,
          direccion: item.direccion,
          latitud: item.latitud,
          longitud: item.longitud,
          distancia: item.distancia,
          rating: null,
          precio: item.presupuestoEstimado,
          telefono: item.telefono,
          url: googleSearchUrl(item.nombre, item.direccion),
        },
        create: {
          proveedor: item.proveedor,
          externalId: item.externalId,
          nombre: item.nombre,
          categoria: item.categoria,
          direccion: item.direccion,
          latitud: item.latitud,
          longitud: item.longitud,
          distancia: item.distancia,
          rating: null,
          precio: item.presupuestoEstimado,
          telefono: item.telefono,
          url: googleSearchUrl(item.nombre, item.direccion),
        },
      });

      enriquecidos.push({
        ...lugar,
        score,
        website: item.website,
        googleUrl: googleSearchUrl(item.nombre, item.direccion),
        presupuestoEstimado: item.presupuestoEstimado,
        fuenteDatos: item.proveedor,
      });
    }

    if (orden === "cercania") {
      enriquecidos.sort((a, b) => (a.distancia ?? 99999) - (b.distancia ?? 99999));
    } else if (orden === "contacto") {
      enriquecidos.sort((a, b) => {
        const ca = a.telefono || a.website ? 1 : 0;
        const cb = b.telefono || b.website ? 1 : 0;
        return cb - ca || b.score - a.score;
      });
    } else {
      enriquecidos.sort((a, b) => b.score - a.score);
    }

    return enriquecidos.slice(0, limit);
  });

  app.get("/detalle/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const lugarId = Number(id);

    if (!Number.isInteger(lugarId)) {
      return reply.code(400).send({ message: "id inválido" });
    }

    const lugar = await prisma.lugarRestauracion.findUnique({
      where: { id_lugar_restauracion: lugarId },
    });

    if (!lugar) {
      return reply.code(404).send({ message: "Restaurante no encontrado" });
    }

    return {
      ...lugar,
      googleUrl: googleSearchUrl(lugar.nombre, lugar.direccion),
      presupuestoEstimado: lugar.precio ?? "medio",
      reviewExternalMessage:
        "Las reseñas, fotos, menú y horarios se consultan en Google para evitar consumir campos Premium de Foursquare.",
    };
  });

  app.post("/seleccionar", async (request, reply) => {
    const body = request.body as {
      id_itinerario?: number;
      id_dia_itinerario?: number;
      momento?: Momento;
      id_lugar_restauracion?: number;
      id_poi_referencia?: number | null;
    };

    if (
      !body.id_itinerario ||
      !body.id_dia_itinerario ||
      !body.momento ||
      !body.id_lugar_restauracion
    ) {
      return reply.code(400).send({ message: "Faltan datos obligatorios" });
    }

    const seleccion = await prisma.itinerarioRestauracion.upsert({
      where: {
        id_itinerario_id_dia_itinerario_momento: {
          id_itinerario: body.id_itinerario,
          id_dia_itinerario: body.id_dia_itinerario,
          momento: body.momento,
        },
      },
      update: {
        id_lugar_restauracion: body.id_lugar_restauracion,
        id_poi_referencia: body.id_poi_referencia ?? null,
      },
      create: {
        id_itinerario: body.id_itinerario,
        id_dia_itinerario: body.id_dia_itinerario,
        momento: body.momento,
        id_lugar_restauracion: body.id_lugar_restauracion,
        id_poi_referencia: body.id_poi_referencia ?? null,
      },
      include: {
        lugar: true,
      },
    });

    return seleccion;
  });

  app.get("/selecciones/:id_itinerario", async (request, reply) => {
    const { id_itinerario } = request.params as { id_itinerario: string };
    const id = Number(id_itinerario);

    if (!Number.isInteger(id)) {
      return reply.code(400).send({ message: "id_itinerario inválido" });
    }

    return prisma.itinerarioRestauracion.findMany({
      where: { id_itinerario: id },
      include: { lugar: true },
      orderBy: [{ id_dia_itinerario: "asc" }, { momento: "asc" }],
    });
  });

  app.delete("/selecciones/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const seleccionId = Number(id);

    if (!Number.isInteger(seleccionId)) {
      return reply.code(400).send({ message: "id inválido" });
    }

    await prisma.itinerarioRestauracion.delete({
      where: { id_itinerario_restauracion: seleccionId },
    });

    return { ok: true };
  });
}
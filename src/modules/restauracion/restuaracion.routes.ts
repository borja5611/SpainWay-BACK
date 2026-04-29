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
  tapas: ["restaurant", "bar"],
  cafeteria: ["cafe"],
  bar: ["bar", "pub"],
  fast_food: ["fast_food"],
  pasteleria: ["bakery", "cafe"],
};

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function googleMapsUrl(nombre: string, direccion: string | null, latitud: number, longitud: number) {
  const query = direccion
    ? `${nombre}, ${direccion}`
    : `${nombre}`;

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}&query_place_id=`;
}

function scoreRestaurante(input: {
  distancia?: number | null;
  rating?: number | null;
  momento: Momento;
  categoria?: string | null;
}) {
  const distancia = input.distancia ?? 9999;
  const rating = input.rating ?? 0;
  const categoria = `${input.categoria ?? ""}`.toLowerCase();

  let score = 50;
  score += Math.max(0, 35 - distancia / 45);
  score += rating * 8;

  if (input.momento === "desayuno" || input.momento === "cafe") {
    if (
      categoria.includes("cafe") ||
      categoria.includes("coffee") ||
      categoria.includes("bakery") ||
      categoria.includes("pasteler")
    ) {
      score += 22;
    }
  }

  if (input.momento === "comida" || input.momento === "cena") {
    if (
      categoria.includes("restaurant") ||
      categoria.includes("restaurante") ||
      categoria.includes("tapas") ||
      categoria.includes("bar")
    ) {
      score += 22;
    }
  }

  return Math.round(score);
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

async function buscarFoursquare(params: {
  lat: number;
  lng: number;
  radio: number;
  tipo: Tipo;
  limit: number;
}) {
  const apiKey = process.env.FSQ_API_KEY;
  if (!apiKey) return [];

  const url = new URL("https://places-api.foursquare.com/places/search");
  url.searchParams.set("ll", `${params.lat},${params.lng}`);
  url.searchParams.set("radius", String(params.radio));
  url.searchParams.set("limit", String(params.limit));
  url.searchParams.set("categories", CATEGORIAS_FSQ[params.tipo] ?? CATEGORIAS_FSQ.todos);

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
      .map((item: any) => {
        const latitud =
          item.latitude ??
          item.geocodes?.main?.latitude ??
          item.location?.latitude;

        const longitud =
          item.longitude ??
          item.geocodes?.main?.longitude ??
          item.location?.longitude;

        if (!latitud || !longitud) return null;

        const externalId = item.fsq_place_id ?? item.fsq_id ?? item.id;
        if (!externalId) return null;

        const categoria =
          item.fsq_category_labels?.[0]?.split(" > ").pop() ??
          item.categories?.[0]?.name ??
          "Restauración";

        return {
          proveedor: "foursquare",
          externalId,
          nombre: item.name ?? "Lugar sin nombre",
          categoria,
          direccion:
            item.address ??
            item.location?.formatted_address ??
            item.location?.address ??
            null,
          latitud,
          longitud,
          distancia:
            typeof item.distance === "number"
              ? item.distance
              : haversineMetros(params.lat, params.lng, latitud, longitud),
          rating: typeof item.rating === "number" ? item.rating : null,
          precio: item.price ? String(item.price) : null,
          telefono: item.tel ?? null,
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.error("Foursquare terminó con error, usamos OpenStreetMap:", error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
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

  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
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
    .map((item: any) => {
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
        rating: null,
        precio: null,
        telefono: item.tags?.phone ?? item.tags?.["contact:phone"] ?? null,
      };
    })
    .filter(Boolean)
    .slice(0, params.limit);
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
    };

    const lat = toNumber(query.lat);
    const lng = toNumber(query.lng);
    const radio = Math.min(Math.max(Number(query.radio ?? 1200), 300), 3000);
    const momento = query.momento ?? "comida";
    const tipo = query.tipo ?? "todos";
    const limit = Math.min(Math.max(Number(query.limit ?? 16), 4), 30);

    if (lat === null || lng === null) {
      return reply.code(400).send({ message: "lat y lng son obligatorios" });
    }

    const fsqResults = await buscarFoursquare({ lat, lng, radio, tipo, limit });

    const externos =
      fsqResults.length > 0
        ? fsqResults
        : await buscarOpenStreetMap({ lat, lng, radio, tipo, limit });

    const guardados = [];

    for (const item of externos as any[]) {
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
          rating: item.rating,
          precio: item.precio,
          telefono: item.telefono,
          url: googleMapsUrl(item.nombre, item.direccion, item.latitud, item.longitud),        },
        create: {
          proveedor: item.proveedor,
          externalId: item.externalId,
          nombre: item.nombre,
          categoria: item.categoria,
          direccion: item.direccion,
          latitud: item.latitud,
          longitud: item.longitud,
          distancia: item.distancia,
          rating: item.rating,
          precio: item.precio,
          telefono: item.telefono,
          url: googleMapsUrl(item.nombre, item.direccion, item.latitud, item.longitud),        },
      });

      guardados.push({
        ...lugar,
        score: scoreRestaurante({
          distancia: lugar.distancia,
          rating: lugar.rating,
          momento,
          categoria: lugar.categoria,
        }),
      });
    }

    return guardados.sort((a, b) => b.score - a.score);
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

  let foursquareDetalle: any = null;
  let tips: any[] = [];

  if (lugar.proveedor === "foursquare" && process.env.FSQ_API_KEY) {
    try {
      const fields = [
        "fsq_id",
        "name",
        "description",
        "tel",
        "website",
        "rating",
        "price",
        "stats",
        "hours",
        "photos",
        "tips",
        "tastes",
        "features",
        "location",
        "geocodes",
      ].join(",");

      const detailUrl = new URL(`https://api.foursquare.com/v3/places/${lugar.externalId}`);
      detailUrl.searchParams.set("fields", fields);

      const detailResponse = await fetch(detailUrl.toString(), {
        headers: {
          Authorization: process.env.FSQ_API_KEY,
          Accept: "application/json",
          "X-Places-Api-Version": "2025-06-17",
        },
      });

      if (detailResponse.ok) {
        foursquareDetalle = await detailResponse.json();
      }

      const tipsUrl = new URL(`https://api.foursquare.com/v3/places/${lugar.externalId}/tips`);
      tipsUrl.searchParams.set("limit", "5");
      tipsUrl.searchParams.set("sort", "POPULAR");

      const tipsResponse = await fetch(tipsUrl.toString(), {
        headers: {
          Authorization: process.env.FSQ_API_KEY,
          Accept: "application/json",
          "X-Places-Api-Version": "2025-06-17",
        },
      });

      if (tipsResponse.ok) {
        const tipsData = await tipsResponse.json();
        tips = Array.isArray(tipsData) ? tipsData : tipsData.results ?? [];
      }
    } catch (error) {
      console.error("No se pudo cargar detalle Foursquare:", error);
    }
  }

  return {
    ...lugar,
    detalle: foursquareDetalle,
    tips,
    mapsUrl: googleMapsUrl(lugar.nombre, lugar.direccion, lugar.latitud, lugar.longitud),
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
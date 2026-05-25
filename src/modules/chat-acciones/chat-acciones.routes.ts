import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import {
  cargarItinerarioDeConversacion,
  insertPoiIntoItinerary,
  movePoiBetweenDays,
  regeneratePartialDay,
  removePoiFromItinerary,
  replacePoiInItinerary,
  resumenDiaActualizado,
  swapPoisInDay,
} from "../itinerarios/itinerario-edicion.service";
import {
  buscarEventosLiveAgregado,
  type LiveEvent,
} from "../eventos-live/eventos-live.routes";

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function normalizar(value?: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const DAY_WORD =
  "(?:\\d+|primer|primero|primera|segundo|segunda|tercer|tercero|tercera|cuarto|cuarta|quinto|quinta|sexto|sexta|septimo|septima|séptimo|séptima|octavo|octava|noveno|novena|decimo|decima|décimo|décima)";

function dayWordToNumber(value?: string | null): number | null {
  const key = normalizar(value);
  const numeric = Number(key);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;

  const map: Record<string, number> = {
    primer: 1,
    primero: 1,
    primera: 1,
    segundo: 2,
    segunda: 2,
    tercer: 3,
    tercero: 3,
    tercera: 3,
    cuarto: 4,
    cuarta: 4,
    quinto: 5,
    quinta: 5,
    sexto: 6,
    sexta: 6,
    septimo: 7,
    septima: 7,
    octavo: 8,
    octava: 8,
    noveno: 9,
    novena: 9,
    decimo: 10,
    decima: 10,
  };

  return map[key] ?? null;
}

function getDayNumberFromText(text: string): number | null {
  const t = normalizar(text);
  const patterns = [
    new RegExp(`(?:dia|día)\\s*(?:n[uú]mero\\s*)?(${DAY_WORD})`, "i"),
    new RegExp(`(${DAY_WORD})\\s*(?:dia|día)`, "i"),
  ];

  for (const pattern of patterns) {
    const match = t.match(pattern);
    const n = dayWordToNumber(match?.[1]);
    if (n) return n;
  }

  return null;
}

function getAllDayNumbers(text: string): number[] {
  const t = normalizar(text);
  const patterns = [
    new RegExp(`(?:dia|día)\\s*(?:n[uú]mero\\s*)?(${DAY_WORD})`, "gi"),
    new RegExp(`(${DAY_WORD})\\s*(?:dia|día)`, "gi"),
  ];

  const result: number[] = [];
  for (const pattern of patterns) {
    for (const match of t.matchAll(pattern)) {
      const n = dayWordToNumber(match[1]);
      if (n && !result.includes(n)) result.push(n);
    }
  }
  return result;
}

function hasRemove(text: string) {
  return /\b(quita|quites|quitar|elimina|elimines|eliminar|borra|borrar|saca|retira|suprime)\b/.test(
    normalizar(text),
  );
}

function hasInsert(text: string) {
  return /\b(anade|añade|anadas|añadas|agrega|agregar|mete|meter|incluye|incorpora|pon|pongas|ponme|aparece|aniade|añadir|anadir)\b/.test(
    normalizar(text),
  );
}

function hasReplace(text: string) {
  const t = normalizar(text);
  return (
    /\b(cambia|cambiar|sustituye|sustituir|reemplaza|reemplazar)\b/.test(t) ||
    (hasRemove(t) && hasInsert(t)) ||
    (hasRemove(t) && /\b(otro|otra|diferente|alternativa)\b/.test(t))
  );
}

function hasMove(text: string) {
  const days = getAllDayNumbers(text);
  const t = normalizar(text);
  return (
    /\b(mueve|mover|pasa|pasar|traslada|trasladar)\b/.test(t) ||
    (hasRemove(t) && hasInsert(t) && days.length >= 2)
  );
}

function hasRegenerate(text: string) {
  const t = normalizar(text);
  return (
    /\b(regenera|regenerar|rehaz|rehacer|rediseña|redisena)\b/.test(t) &&
    /\b(dia|día)\b/.test(t)
  );
}

function hasSwap(text: string) {
  return /\b(intercambia|intercambiar|swap|cambia el orden|mueve.*posicion|posición)\b/.test(
    normalizar(text),
  );
}

function stripDayReferences(text: string): string {
  return normalizar(text)
    .replace(
      new RegExp(
        `(?:del|de la|de el|al|a la|a el|en el|en la|para el|para la|al)?\\s*(?:dia|día)\\s*${DAY_WORD}`,
        "gi",
      ),
      " ",
    )
    .replace(
      new RegExp(
        `(?:del|de la|de el|al|a la|a el|en el|en la|para el|para la|al)?\\s*${DAY_WORD}\\s*(?:dia|día)`,
        "gi",
      ),
      " ",
    );
}

function limpiarPoiName(text: string): string {
  return stripDayReferences(text)
    .replace(
      /\b(?:quita|quites|quitar|elimina|elimines|eliminar|borra|borrar|saca|retira|suprime|anade|añade|anadas|añadas|agrega|agregar|mete|meter|incluye|incorpora|pon|pongas|ponme|aparece|mueve|mover|pasa|pasar|traslada|cambia|cambiar|sustituye|reemplaza|aniade|añadir|anadir)\b/g,
      " ",
    )
    .replace(
      /\b(?:quiero|que|me|mi|el|la|los|las|un|una|unos|unas|poi|pois|punto|puntos|sitio|sitios|lugar|lugares|nuevo|nueva|nuevos|nuevas|porfa|favor|por|de|del|a|al|en|lo|le|para|y|tambien|también|buenas|tardes|buenos|dias|día|dia|hola|ese|esa|este|esta|nuestro|nuestra)\b/g,
      " ",
    )
    .replace(/[^a-z0-9ñç\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getActionSegment(text: string, words: string): string | null {
  const t = normalizar(text);
  const pattern = new RegExp(
    `(?:${words})\\s+(?:el|la|los|las|un|una|poi|pois|punto|sitio|lugar)?\\s*([\\s\\S]+?)(?:\\s+y\\s+(?:lo\\s+)?(?:anade|añade|anadas|añadas|agrega|mete|incluye|pon|pongas|pasa|mueve|aparece|aniade|anadir|añadir|cambia|sustituye|reemplaza)\\b|\\s+(?:del|de la|de el|al|a la|a el|en el|en la|para el|para la)\\s*(?:dia|día)\\s*${DAY_WORD}|[,.;]|$)`,
    "i",
  );
  const match = t.match(pattern);
  return match?.[1] ?? null;
}

function extractRemoveName(text: string) {
  const actionWords =
    "quita|quites|quitar|elimina|elimines|eliminar|borra|borrar|saca|retira|suprime";
  const captured = getActionSegment(text, actionWords);
  return limpiarPoiName(captured || text);
}

function extractInsertQuery(text: string) {
  const actionWords =
    "anade|añade|anadas|añadas|agrega|agregar|mete|meter|incluye|incorpora|pon|pongas|ponme|aparece|aniade|añadir|anadir";
  const captured = getActionSegment(text, actionWords);
  const cleaned = limpiarPoiName(captured || text)
    .replace(
      /\b(?:mejor|mejores|valora|valores|valorado|valorada|valorados|valoradas|cercano|cercana|cercanos|cercanas|tipo|cosas|alguna|alguno|algo|otro|otra|diferente|alternativa)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  const t = normalizar(text);
  if (cleaned && !["poi", "pois", "punto", "sitio", "lugar"].includes(cleaned))
    return cleaned;

  if (t.includes("playa")) return "playa";
  if (t.includes("gastronom")) return "gastronomía";
  if (t.includes("naturaleza")) return "naturaleza";
  if (t.includes("museo")) return "museo";
  if (t.includes("mirador")) return "mirador";
  return "destacado turístico";
}

function extractSwapPositions(
  text: string,
): { fromIndex: number; toIndex: number } | null {
  const t = normalizar(text);
  const nums = [...t.matchAll(/(?:posicion|posición|parada)?\s*(\d+)/g)].map(
    (m) => Number(m[1]),
  );
  if (nums.length >= 2) return { fromIndex: nums[0] - 1, toIndex: nums[1] - 1 };
  return null;
}

async function crearMensaje(
  idConversacion: number,
  rol: "user" | "assistant",
  contenido: string,
) {
  return prisma.mensaje.create({
    data: {
      id_conversacion: idConversacion,
      rol,
      contenido,
      creado: new Date(),
    },
  });
}

function respuestaConDetalle(
  texto: string,
  itinerario: any,
  dayNumber: number,
) {
  return `${texto}\n\nDía ${dayNumber} actualizado:\n${resumenDiaActualizado(itinerario, dayNumber)}`;
}

function hasEventSearch(text: string) {
  const t = normalizar(text);
  return /\b(evento|eventos|concierto|conciertos|festival|festivales|teatro|obra|obras|show|shows|actuacion|actuaciones|directo|live)\b/.test(
    t,
  );
}

function inferirDestinoEventos(text: string, fallback?: string | null) {
  const raw = text.trim();
  const explicit = raw.match(
    /(?:en|por|cerca de)\s+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]{2,40})(?:\s+(?:hoy|mañana|manana|este|esta|el|la|durante|para|con|de)|[?.!,]|$)/,
  );
  if (explicit?.[1]) return explicit[1].trim();

  const known = raw.match(
    /(?:madrid|valencia|barcelona|sevilla|malaga|málaga|granada|bilbao|zaragoza|alicante|cantabria|santander|tenerife|canarias|baleares|ibiza)/i,
  );
  if (known?.[0]) return known[0].trim();

  const fallbackClean = fallback
    ?.replace(/itinerario/gi, "")
    .replace(/viaje/gi, "")
    .replace(/spainway/gi, "")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return fallbackClean || null;
}

function ymdMadrid(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((part) => part.type === "year")?.value ?? "";
  const m = parts.find((part) => part.type === "month")?.value ?? "";
  const d = parts.find((part) => part.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function rangoFechasEventos(
  text: string,
  itinerario?: any,
): { from: string; to: string } {
  const t = normalizar(text);
  const today = new Date();

  if (
    itinerario?.inicio &&
    itinerario?.fin &&
    !t.includes("hoy") &&
    !t.includes("mañana") &&
    !t.includes("manana") &&
    !t.includes("fin de semana")
  ) {
    return {
      from: String(itinerario.inicio).slice(0, 10),
      to: String(itinerario.fin).slice(0, 10),
    };
  }

  if (t.includes("hoy")) {
    const d = ymdMadrid(today);
    return { from: d, to: d };
  }

  if (t.includes("mañana") || t.includes("manana")) {
    const d = ymdMadrid(addDays(today, 1));
    return { from: d, to: d };
  }

  if (t.includes("fin de semana") || t.includes("finde")) {
    const day = today.getDay();
    const daysToSaturday = (6 - day + 7) % 7;
    const sat = addDays(today, daysToSaturday);
    const sun = addDays(sat, 1);
    return { from: ymdMadrid(sat), to: ymdMadrid(sun) };
  }

  return { from: ymdMadrid(today), to: ymdMadrid(addDays(today, 7)) };
}

type ParsedChatAction = {
  action?: string | null;
  destination?: string | null;
  quantity?: number | null;
  query?: string | null;
  dayNumber?: number | null;
  fromDayNumber?: number | null;
  toDayNumber?: number | null;
  poiName?: string | null;
  oldPoiName?: string | null;
  interests?: string[] | null;
  transport?: string | null;
  pace?: string | null;
  time_context?: string | null;
  confidence?: number | null;
  reasoning_short?: string | null;
  used_external_llm?: boolean;
};

function isGenericChange(text?: string | null): boolean {
  const t = normalizar(text);
  if (!t) return false;
  return /\b(otros|otras|diferentes|cambialos|cambiarlos|cambia los pois|cambia todos|renueva|renovar|sustituye todos|pon otros)\b/.test(
    t,
  );
}

function sanitizeParsedAction(
  parsed: ParsedChatAction | null,
  contenido: string,
): ParsedChatAction {
  const fallbackDay = getDayNumberFromText(contenido);
  const action = parsed?.action || "unknown";
  return {
    action,
    destination: parsed?.destination || null,
    quantity: typeof parsed?.quantity === "number" ? parsed.quantity : null,
    query: parsed?.query || null,
    dayNumber:
      typeof parsed?.dayNumber === "number" ? parsed.dayNumber : fallbackDay,
    fromDayNumber:
      typeof parsed?.fromDayNumber === "number" ? parsed.fromDayNumber : null,
    toDayNumber:
      typeof parsed?.toDayNumber === "number" ? parsed.toDayNumber : null,
    poiName: parsed?.poiName || null,
    oldPoiName: parsed?.oldPoiName || null,
    interests: Array.isArray(parsed?.interests) ? parsed?.interests : null,
    transport: parsed?.transport || null,
    pace: parsed?.pace || null,
    time_context: parsed?.time_context || null,
    confidence: typeof parsed?.confidence === "number" ? parsed.confidence : 0,
    reasoning_short: parsed?.reasoning_short || null,
    used_external_llm: Boolean(parsed?.used_external_llm),
  };
}

async function llamarParserIA(params: {
  contenido: string;
  conversacion: any;
  itinerario: any | null;
  idConversacion: number;
}): Promise<ParsedChatAction> {
  const mensajes = await prisma.mensaje.findMany({
    where: { id_conversacion: params.idConversacion },
    orderBy: { creado: "desc" },
    take: 10,
  });

  const poisByDay = (
    params.itinerario?.dias ||
    params.itinerario?.day_plans ||
    []
  ).map((dia: any) => ({
    dayNumber:
      dia.numero_dia ?? dia.day_number ?? dia.dia ?? dia.numero ?? null,
    theme: dia.titulo ?? dia.theme ?? dia.nombre ?? null,
    pois: (dia.elementos || dia.pois || [])
      .map((el: any) => ({
        name: el.poi?.nombre ?? el.nombre ?? el.name ?? el.poiName ?? null,
        category:
          el.poi?.categoria?.nombre ?? el.categoria ?? el.category ?? null,
        municipality:
          el.poi?.municipio?.nombre ?? el.municipio ?? el.municipality ?? null,
      }))
      .filter((x: any) => x.name),
  }));

  const payload = {
    message: params.contenido,
    current_destination:
      params.itinerario?.destino ?? params.conversacion?.titulo ?? null,
    current_days:
      params.itinerario?.dias?.length ??
      params.itinerario?.day_plans?.length ??
      null,
    itinerary_id: params.itinerario?.id_itinerario ?? null,
    pois_by_day: poisByDay,
    recent_messages: mensajes.reverse().map((msg) => ({
      role: msg.rol,
      content: String(msg.contenido || "").slice(0, 700),
    })),
    force_external_llm: true,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(
      `${env.RECOMMENDER_API_URL.replace(/\/$/, "")}/chat/parse-action`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );
    if (!response.ok) return sanitizeParsedAction(null, params.contenido);
    const data = await response.json();
    return sanitizeParsedAction(data, params.contenido);
  } catch {
    return sanitizeParsedAction(null, params.contenido);
  } finally {
    clearTimeout(timeout);
  }
}


function getDestinoPoiWhereChat(destino?: string | null): any {
  const d = normalizar(destino);
  if (!d) return {};

  if (d.includes("valencia")) {
    return {
      OR: [
        { direccion: { contains: "Valencia", mode: "insensitive" as const } },
        { municipio: { nombre: { contains: "Valencia", mode: "insensitive" as const } } },
        { municipio: { provincia: { nombre: { contains: "Valencia", mode: "insensitive" as const } } } },
        { municipio: { provincia: { comunidad: { nombre: { contains: "Valenciana", mode: "insensitive" as const } } } } },
        { destacados_ccaa: { some: { comunidad: { contains: "valencia", mode: "insensitive" as const } } } },
      ],
    };
  }

  if (d.includes("barcelona") || d.includes("cataluna") || d.includes("catalunya")) {
    return {
      OR: [
        { direccion: { contains: "Barcelona", mode: "insensitive" as const } },
        { municipio: { nombre: { contains: "Barcelona", mode: "insensitive" as const } } },
        { municipio: { provincia: { nombre: { contains: "Barcelona", mode: "insensitive" as const } } } },
        { municipio: { provincia: { comunidad: { nombre: { contains: "Catal", mode: "insensitive" as const } } } } },
        { destacados_ccaa: { some: { comunidad: { contains: "catal", mode: "insensitive" as const } } } },
      ],
    };
  }

  if (d.includes("madrid")) {
    return {
      OR: [
        { direccion: { contains: "Madrid", mode: "insensitive" as const } },
        { municipio: { nombre: { contains: "Madrid", mode: "insensitive" as const } } },
        { municipio: { provincia: { nombre: { contains: "Madrid", mode: "insensitive" as const } } } },
        { municipio: { provincia: { comunidad: { nombre: { contains: "Madrid", mode: "insensitive" as const } } } } },
        { destacados_ccaa: { some: { comunidad: { contains: "madrid", mode: "insensitive" as const } } } },
      ],
    };
  }

  const limpio = destino?.split(",").map((x) => x.trim()).filter(Boolean).at(-1) || destino || "";
  return {
    OR: [
      { direccion: { contains: limpio, mode: "insensitive" as const } },
      { municipio: { nombre: { contains: limpio, mode: "insensitive" as const } } },
      { municipio: { provincia: { nombre: { contains: limpio, mode: "insensitive" as const } } } },
      { municipio: { provincia: { comunidad: { nombre: { contains: limpio, mode: "insensitive" as const } } } } },
      { destacados_ccaa: { some: { comunidad: { contains: limpio, mode: "insensitive" as const } } } },
    ],
  };
}

function getTextoPoiChat(poi: any): string {
  return [
    poi?.nombre,
    poi?.tipo,
    poi?.subcategoria,
    poi?.descripcion,
    poi?.direccion,
    poi?.categoria_poi?.nombre,
    poi?.municipio?.nombre,
    poi?.municipio?.provincia?.nombre,
    poi?.municipio?.provincia?.comunidad?.nombre,
  ]
    .filter(Boolean)
    .join(" ");
}

function scorePoiChat(poi: any, intereses: string[]) {
  const texto = normalizar(getTextoPoiChat(poi));
  const hits = intereses.reduce((acc, item) => acc + (texto.includes(normalizar(item)) ? 1 : 0), 0);
  return (
    hits * 4 +
    (poi.destacados_ccaa?.length ? 4 : 0) +
    (poi.latitud && poi.longitud ? 1 : -2) +
    (poi.descripcion ? 1 : 0) +
    Number(poi.puntuacion || 0) +
    Number(poi.popularidad || 0) / 100
  );
}

async function recomendarPoisLocalFallback(params: {
  destino: string;
  quantity: number;
  intereses: string[];
}) {
  const destinoWhere = getDestinoPoiWhereChat(params.destino);
  const textWhere = params.intereses.length
    ? {
        OR: params.intereses.flatMap((pref) => [
          { nombre: { contains: pref, mode: "insensitive" as const } },
          { tipo: { contains: pref, mode: "insensitive" as const } },
          { subcategoria: { contains: pref, mode: "insensitive" as const } },
          { descripcion: { contains: pref, mode: "insensitive" as const } },
          { categoria_poi: { nombre: { contains: pref, mode: "insensitive" as const } } },
        ]),
      }
    : {};

  const pois = await prisma.poi.findMany({
    where: { valido: { not: false }, AND: [destinoWhere, textWhere] },
    include: {
      municipio: { include: { provincia: { include: { comunidad: true } } } },
      categoria_poi: true,
      destacados_ccaa: true,
    },
    take: 300,
  });

  return pois
    .map((poi: any) => ({ poi, score: scorePoiChat(poi, params.intereses) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, params.quantity)
    .map(({ poi }: any) => ({
      id_poi: poi.id_poi,
      id: poi.id_poi,
      global_id: poi.id_global,
      name: poi.nombre,
      nombre: poi.nombre,
      category: poi.categoria_poi?.nombre || poi.tipo || "Lugar",
      categoria: poi.categoria_poi?.nombre || poi.tipo || "Lugar",
      subcategory: poi.subcategoria || null,
      municipality: poi.municipio?.nombre || null,
      municipio: poi.municipio?.nombre || null,
      province: poi.municipio?.provincia?.nombre || null,
      ccaa: poi.municipio?.provincia?.comunidad?.nombre || null,
      address: poi.direccion || null,
      lat: poi.latitud ?? null,
      lon: poi.longitud ?? null,
      description: poi.descripcion || "Lugar recomendado por SpainWay a partir de POIs reales de la base de datos.",
      descripcion: poi.descripcion || null,
      image_url: poi.destacados_ccaa?.find((item: any) => item.imagen_url)?.imagen_url || null,
      reason: "Recomendación local de respaldo usando POIs reales de la base de datos.",
      tags: ["fallback_backend", "poi_real"],
    }));
}

async function recomendarPoisLibres(params: {
  idConversacion: number;
  user: any;
  contenido: string;
  parsed: ParsedChatAction;
  fallbackDestino?: string | null;
}) {
  const destino =
    params.parsed.destination ||
    inferirDestinoEventos(params.contenido, params.fallbackDestino) ||
    params.fallbackDestino;
  if (!destino) {
    const assistant = await crearMensaje(
      params.idConversacion,
      "assistant",
      "Dime el destino para recomendarte sitios reales. Ejemplo: “quiero 2 museos en Valencia esta tarde”.",
    );
    return {
      user: params.user,
      assistant,
      action: "recommend_need_destination",
      parsed: params.parsed,
    };
  }

  const quantity = Math.min(
    Math.max(Number(params.parsed.quantity || 3), 1),
    6,
  );
  const intereses = params.parsed.interests?.length
    ? params.parsed.interests
    : [params.parsed.query || "cultura"];
  const payload = {
    destination: destino,
    days: 1,
    pace: params.parsed.pace || "relajado",
    transport: params.parsed.transport || "transporte público",
    interests: intereses,
    must_include: [],
    excluded_poi_global_ids: [],
    excluded_poi_names: [],
    negative_preferences: [],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(
      `${env.RECOMMENDER_API_URL.replace(/\/$/, "")}/recommend/pois`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error(`IA ${response.status}`);
    const data = await response.json();
    const items = Array.isArray(data.items)
      ? data.items.slice(0, quantity)
      : [];

    const texto = items.length
      ? `Te recomiendo ${items.length} sitios reales en ${destino}:\n\n${items
          .map((poi: any, i: number) => {
            const name = poi.name || poi.nombre || "POI";
            const cat = poi.category || poi.categoria || "lugar";
            const muni =
              poi.municipality || poi.municipio || poi.province || "";
            const desc = String(
              poi.description || poi.descripcion || poi.reason || "",
            )
              .replace(/\s+/g, " ")
              .slice(0, 180);
            return `${i + 1}. ${name}\n   Tipo: ${cat}${muni ? ` · ${muni}` : ""}${desc ? `\n   ${desc}${desc.length >= 180 ? "..." : ""}` : ""}`;
          })
          .join("\n\n")}`
      : `No he encontrado POIs suficientemente fiables en ${destino} para esa consulta. Prueba con otro interés o amplía el destino.`;

    const assistant = await crearMensaje(
      params.idConversacion,
      "assistant",
      texto,
    );
    return {
      user: params.user,
      assistant,
      action: "recommend_pois",
      pois: items,
      parsed: params.parsed,
    };
  } catch (error) {
    // Respaldo definitivo: si la IA tarda, Render está frío o /recommend/pois cae,
    // nunca dejamos al usuario sin respuesta. Buscamos POIs reales en PostgreSQL.
    try {
      const items = await recomendarPoisLocalFallback({ destino, quantity, intereses });
      const texto = items.length
        ? `Te recomiendo ${items.length} sitios reales en ${destino}:\n\n${items
            .map((poi: any, i: number) => {
              const name = poi.name || poi.nombre || "POI";
              const cat = poi.category || poi.categoria || "lugar";
              const muni = poi.municipality || poi.municipio || poi.province || "";
              const desc = String(poi.description || poi.descripcion || poi.reason || "")
                .replace(/\s+/g, " ")
                .slice(0, 180);
              return `${i + 1}. ${name}\n   Tipo: ${cat}${muni ? ` · ${muni}` : ""}${desc ? `\n   ${desc}${desc.length >= 180 ? "..." : ""}` : ""}`;
            })
            .join("\n\n")}\n\nHe usado el respaldo local porque el recomendador IA no respondió a tiempo.`
        : `No he encontrado POIs suficientemente fiables en ${destino}. Prueba con otro interés o amplía el destino.`;

      const assistant = await crearMensaje(params.idConversacion, "assistant", texto);
      return {
        user: params.user,
        assistant,
        action: "recommend_pois_fallback_backend",
        pois: items,
        parsed: params.parsed,
        warning: error instanceof Error ? error.message : "recommend_timeout_or_error",
      };
    } catch (fallbackError) {
      const assistant = await crearMensaje(
        params.idConversacion,
        "assistant",
        "No he podido consultar el recomendador ahora mismo. Prueba de nuevo en unos segundos.",
      );
      return {
        user: params.user,
        assistant,
        action: "recommend_error",
        error: fallbackError instanceof Error ? fallbackError.message : error instanceof Error ? error.message : "error",
        parsed: params.parsed,
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

function formatearEventoChat(event: LiveEvent, index: number) {
  const fecha = event.fechaInicio
    ? new Date(event.fechaInicio).toLocaleString("es-ES", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "fecha pendiente";
  const lugar = [event.recinto, event.ciudad].filter(Boolean).join(" · ");
  return `${index + 1}. ${event.nombre}\n   ${fecha}${lugar ? ` · ${lugar}` : ""}\n   Fuente: ${event.provider}`;
}

async function responderBusquedaEventos(params: {
  idConversacion: number;
  user: any;
  contenido: string;
  itinerario?: any;
  fallbackDestino?: string | null;
}) {
  const destino = inferirDestinoEventos(
    params.contenido,
    params.fallbackDestino ?? params.itinerario?.destino ?? null,
  );

  if (!destino) {
    const assistant = await crearMensaje(
      params.idConversacion,
      "assistant",
      "Dime en qué ciudad o destino quieres buscar eventos. Ejemplo: “conciertos en Madrid este fin de semana”.",
    );
    return {
      user: params.user,
      assistant,
      action: "events_need_destination",
      eventos: [],
    };
  }

  const rango = rangoFechasEventos(params.contenido, params.itinerario);
  const resultado = await buscarEventosLiveAgregado({
    city: destino,
    from: rango.from,
    to: rango.to,
    lat:
      params.itinerario?.base_latitud ??
      params.itinerario?.base_latitude ??
      null,
    lng:
      params.itinerario?.base_longitud ??
      params.itinerario?.base_longitude ??
      null,
    radiusKm: 35,
  });

  const eventos = resultado.events.slice(0, 6);
  const texto = eventos.length
    ? `He encontrado ${eventos.length} eventos en ${destino} entre ${rango.from} y ${rango.to}:\n\n${eventos.map(formatearEventoChat).join("\n\n")}`
    : `${resultado.message || `No he encontrado eventos relevantes en ${destino} para esas fechas.`}\n\nHe consultado Ticketmaster, PredictHQ y Google Events mediante SerpApi cuando está configurado.`;

  const assistant = await crearMensaje(
    params.idConversacion,
    "assistant",
    texto,
  );
  return {
    user: params.user,
    assistant,
    action: "search_events",
    eventos,
    destino,
    from: rango.from,
    to: rango.to,
    providers: resultado.providers,
  };
}

export default async function chatAccionesRoutes(app: FastifyInstance) {
  app.post("/:id_conversacion/procesar", async (request, reply) => {
    const { id_conversacion } = request.params as { id_conversacion: string };
    const idConversacion = toInt(id_conversacion);

    if (idConversacion === null) {
      return reply.code(400).send({ message: "id_conversacion inválido" });
    }

    const body = request.body as { contenido?: string };
    const contenido = body.contenido?.trim();
    if (!contenido) {
      return reply
        .code(400)
        .send({ message: "El contenido del mensaje es obligatorio" });
    }

    const conversacion = await prisma.conversacion.findUnique({
      where: { id_conversacion: idConversacion },
    });

    if (!conversacion) {
      return reply.code(404).send({ message: "Conversación no encontrada" });
    }

    const user = await crearMensaje(idConversacion, "user", contenido);

    try {
      const itinerario = await cargarItinerarioDeConversacion(idConversacion);

      // MUY IMPORTANTE: cada mensaje pasa primero por IA/OpenAI si está activo.
      // Si OpenAI no está configurado o falla, la IA devuelve parser interno y no rompe.
      const parsed = await llamarParserIA({
        contenido,
        conversacion,
        itinerario,
        idConversacion,
      });

      if (parsed.action === "search_events" || hasEventSearch(contenido)) {
        return responderBusquedaEventos({
          idConversacion,
          user,
          contenido,
          itinerario: itinerario ?? undefined,
          fallbackDestino: parsed.destination || conversacion.titulo,
        });
      }

      if (!itinerario) {
        return recomendarPoisLibres({
          idConversacion,
          user,
          contenido,
          parsed,
          fallbackDestino: parsed.destination || conversacion.titulo,
        });
      }

      const days = getAllDayNumbers(contenido);

      if (
        (parsed.action === "move" || hasMove(contenido)) &&
        (days.length >= 2 || (parsed.fromDayNumber && parsed.toDayNumber))
      ) {
        const fromDay = parsed.fromDayNumber ?? days[0];
        const toDay = parsed.toDayNumber ?? days[1];
        const poiName =
          parsed.poiName || parsed.oldPoiName || extractRemoveName(contenido);
        const result = await movePoiBetweenDays(
          itinerario.id_itinerario,
          fromDay,
          toDay,
          poiName,
        );
        const assistant = await crearMensaje(
          idConversacion,
          "assistant",
          respuestaConDetalle(
            `He movido ${result.poiName} del día ${fromDay} al día ${toDay}.`,
            result.itinerario,
            toDay,
          ),
        );
        return {
          user,
          assistant,
          action: "move_poi",
          itinerario: result.itinerario,
        };
      }

      if (hasSwap(contenido)) {
        const dayNumber = getDayNumberFromText(contenido) ?? 1;
        const positions = extractSwapPositions(contenido);
        if (!positions) {
          throw new Error(
            "Para intercambiar POIs dime las posiciones. Ejemplo: intercambia la parada 1 y 3 del día 2.",
          );
        }
        const actualizado = await swapPoisInDay(
          itinerario.id_itinerario,
          dayNumber,
          positions.fromIndex,
          positions.toIndex,
        );
        const assistant = await crearMensaje(
          idConversacion,
          "assistant",
          respuestaConDetalle(
            `He cambiado el orden del día ${dayNumber}.`,
            actualizado,
            dayNumber,
          ),
        );
        return { user, assistant, action: "swap_poi", itinerario: actualizado };
      }

      if (
        parsed.action === "regenerate_day" ||
        (hasReplace(contenido) && isGenericChange(contenido))
      ) {
        const dayNumber =
          parsed.dayNumber ?? getDayNumberFromText(contenido) ?? 1;
        const actualizado = await regeneratePartialDay(
          itinerario.id_itinerario,
          dayNumber,
          contenido,
        );
        const assistant = await crearMensaje(
          idConversacion,
          "assistant",
          respuestaConDetalle(
            `He cambiado los POIs del día ${dayNumber} por una nueva selección más coherente.`,
            actualizado,
            dayNumber,
          ),
        );
        return {
          user,
          assistant,
          action: "regenerate_day",
          itinerario: actualizado,
          parsed,
        };
      }

      if (parsed.action === "replace" || hasReplace(contenido)) {
        const dayNumber =
          parsed.dayNumber ?? getDayNumberFromText(contenido) ?? 1;
        const oldPoiName = parsed.oldPoiName || extractRemoveName(contenido);
        const query =
          parsed.query || parsed.poiName || extractInsertQuery(contenido);
        const result = await replacePoiInItinerary(
          itinerario.id_itinerario,
          dayNumber,
          { oldPoiName, query },
        );
        const assistant = await crearMensaje(
          idConversacion,
          "assistant",
          respuestaConDetalle(
            `He cambiado ${result.oldPoiName} por ${result.poi.nombre} en el día ${dayNumber}.`,
            result.itinerario,
            dayNumber,
          ),
        );
        return {
          user,
          assistant,
          action: "replace_poi",
          itinerario: result.itinerario,
          parsed,
        };
      }

      if (parsed.action === "remove" || hasRemove(contenido)) {
        const dayNumber =
          parsed.dayNumber ?? getDayNumberFromText(contenido) ?? 1;
        const poiName =
          parsed.poiName || parsed.oldPoiName || extractRemoveName(contenido);
        const result = await removePoiFromItinerary(
          itinerario.id_itinerario,
          dayNumber,
          poiName,
        );
        const assistant = await crearMensaje(
          idConversacion,
          "assistant",
          respuestaConDetalle(
            `He quitado ${result.poiName} del día ${dayNumber}.`,
            result.itinerario,
            dayNumber,
          ),
        );
        return {
          user,
          assistant,
          action: "remove_poi",
          itinerario: result.itinerario,
          parsed,
        };
      }

      if (parsed.action === "insert" || hasInsert(contenido)) {
        const dayNumber =
          parsed.dayNumber ?? getDayNumberFromText(contenido) ?? 1;
        const query =
          parsed.poiName || parsed.query || extractInsertQuery(contenido);
        const result = await insertPoiIntoItinerary(
          itinerario.id_itinerario,
          dayNumber,
          { query, poiName: query },
        );
        const assistant = await crearMensaje(
          idConversacion,
          "assistant",
          respuestaConDetalle(
            `He añadido ${result.poi.nombre} al día ${dayNumber}.`,
            result.itinerario,
            dayNumber,
          ),
        );
        return {
          user,
          assistant,
          action: "insert_poi",
          itinerario: result.itinerario,
          poi: result.poi,
          parsed,
        };
      }

      if (parsed.action === "regenerate_day" || hasRegenerate(contenido)) {
        const dayNumber =
          parsed.dayNumber ?? getDayNumberFromText(contenido) ?? 1;
        const actualizado = await regeneratePartialDay(
          itinerario.id_itinerario,
          dayNumber,
          contenido,
        );
        const assistant = await crearMensaje(
          idConversacion,
          "assistant",
          respuestaConDetalle(
            `He regenerado solo el día ${dayNumber}. El resto del itinerario se mantiene igual.`,
            actualizado,
            dayNumber,
          ),
        );
        return {
          user,
          assistant,
          action: "regenerate_day",
          itinerario: actualizado,
          parsed,
        };
      }

      const assistant = await crearMensaje(
        idConversacion,
        "assistant",
        "No he modificado nada porque necesito una orden más concreta. Prueba así: “quita Plaza Mayor del día 2”, “añade 2 POIs al día 3” o “cambia Puerta del Sol del día 2 por otro diferente”.",
      );
      return { user, assistant, action: "no_action", parsed };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo aplicar el cambio.";
      const assistant = await crearMensaje(
        idConversacion,
        "assistant",
        `No he podido modificar el itinerario: ${message}`,
      );
      return reply
        .code(200)
        .send({ user, assistant, action: "error", error: message });
    }
  });
}

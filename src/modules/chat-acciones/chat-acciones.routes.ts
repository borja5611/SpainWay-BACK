import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
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

type AccionIaParseada = {
  action?: "insert" | "remove" | "replace" | "move" | "swap" | "regenerate_day" | "recommend" | "unknown";
  dayNumber?: number | null;
  fromDayNumber?: number | null;
  toDayNumber?: number | null;
  poiName?: string | null;
  oldPoiName?: string | null;
  query?: string | null;
  quantity?: number | null;
  destination?: string | null;
  time_context?: string | null;
  confidence?: number | null;
  used_external_llm?: boolean;
};

function getRecommenderBaseUrl(): string | null {
  const url = process.env.RECOMMENDER_API_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

function getResumenPoisPorDia(itinerario: any) {
  return (itinerario?.dias ?? []).map((dia: any, index: number) => ({
    dayNumber: index + 1,
    pois: (dia.elementos ?? []).map((elemento: any) => ({
      id_poi: elemento.id_poi,
      nombre: elemento.poi?.nombre ?? null,
      categoria: elemento.poi?.categoria_poi?.nombre ?? elemento.poi?.tipo ?? elemento.poi?.subcategoria ?? null,
    })),
  }));
}

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function interpretarConIaExterna(contenido: string, itinerario: any): Promise<AccionIaParseada | null> {
  const baseUrl = getRecommenderBaseUrl();
  if (!baseUrl) return null;

  try {
    const response = await fetch(`${baseUrl}/chat/parse-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: contenido,
        current_destination: itinerario?.destino ?? null,
        current_days: Array.isArray(itinerario?.dias) ? itinerario.dias.length : null,
        pois_by_day: getResumenPoisPorDia(itinerario),
      }),
    });

    if (!response.ok) return null;
    const data = (await response.json()) as AccionIaParseada;
    const confidence = Number(data.confidence ?? 0);
    if (!data.action || data.action === "unknown" || confidence < 0.55) return null;
    return data;
  } catch (error) {
    console.warn("No se pudo interpretar el mensaje con IA externa. Se usa fallback interno.", error);
    return null;
  }
}

function elegirDiaParaInsertar(itinerario: any, preferido?: number | null): number {
  const n = toPositiveInt(preferido);
  if (n) return n;
  const dias = Array.isArray(itinerario?.dias) ? itinerario.dias : [];
  if (!dias.length) return 1;
  const ordenado = [...dias]
    .map((dia: any, index: number) => ({ dayNumber: index + 1, count: Array.isArray(dia.elementos) ? dia.elementos.length : 0 }))
    .sort((a, b) => a.count - b.count || a.dayNumber - b.dayNumber);
  return ordenado[0]?.dayNumber ?? 1;
}

function limpiarQueryIa(value?: string | null): string {
  return String(value ?? "")
    .replace(/\b(en|un|una|solo|sola|día|dia|del|de|la|el|los|las|por favor|porfa)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
  return /\b(quita|quites|quitar|elimina|elimines|eliminar|borra|borrar|saca|retira|suprime)\b/.test(normalizar(text));
}

function hasInsert(text: string) {
  return /\b(anade|añade|anadas|añadas|agrega|agregar|mete|meter|incluye|incorpora|pon|pongas|ponme|aparece|aniade|añadir|anadir)\b/.test(normalizar(text));
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
  return /\b(regenera|regenerar|rehaz|rehacer|rediseña|redisena)\b/.test(t) && /\b(dia|día)\b/.test(t);
}

function hasSwap(text: string) {
  return /\b(intercambia|intercambiar|swap|cambia el orden|mueve.*posicion|posición)\b/.test(normalizar(text));
}

function stripDayReferences(text: string): string {
  return normalizar(text)
    .replace(new RegExp(`(?:del|de la|de el|al|a la|a el|en el|en la|para el|para la|al)?\\s*(?:dia|día)\\s*${DAY_WORD}`, "gi"), " ")
    .replace(new RegExp(`(?:del|de la|de el|al|a la|a el|en el|en la|para el|para la|al)?\\s*${DAY_WORD}\\s*(?:dia|día)`, "gi"), " ");
}

function limpiarPoiName(text: string): string {
  return stripDayReferences(text)
    .replace(/\b(?:quita|quites|quitar|elimina|elimines|eliminar|borra|borrar|saca|retira|suprime|anade|añade|anadas|añadas|agrega|agregar|mete|meter|incluye|incorpora|pon|pongas|ponme|aparece|mueve|mover|pasa|pasar|traslada|cambia|cambiar|sustituye|reemplaza|aniade|añadir|anadir)\b/g, " ")
    .replace(/\b(?:quiero|que|me|mi|el|la|los|las|un|una|unos|unas|poi|pois|punto|puntos|sitio|sitios|lugar|lugares|nuevo|nueva|nuevos|nuevas|porfa|favor|por|de|del|a|al|en|lo|le|para|y|tambien|también|buenas|tardes|buenos|dias|día|dia|hola|ese|esa|este|esta|nuestro|nuestra)\b/g, " ")
    .replace(/[^a-z0-9ñç\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getActionSegment(text: string, words: string): string | null {
  const t = normalizar(text);
  const pattern = new RegExp(`(?:${words})\\s+(?:el|la|los|las|un|una|poi|pois|punto|sitio|lugar)?\\s*([\\s\\S]+?)(?:\\s+y\\s+(?:lo\\s+)?(?:anade|añade|anadas|añadas|agrega|mete|incluye|pon|pongas|pasa|mueve|aparece|aniade|anadir|añadir|cambia|sustituye|reemplaza)\\b|\\s+(?:del|de la|de el|al|a la|a el|en el|en la|para el|para la)\\s*(?:dia|día)\\s*${DAY_WORD}|[,.;]|$)`, "i");
  const match = t.match(pattern);
  return match?.[1] ?? null;
}

function extractRemoveName(text: string) {
  const actionWords = "quita|quites|quitar|elimina|elimines|eliminar|borra|borrar|saca|retira|suprime";
  const captured = getActionSegment(text, actionWords);
  return limpiarPoiName(captured || text);
}

function extractInsertQuery(text: string) {
  const actionWords = "anade|añade|anadas|añadas|agrega|agregar|mete|meter|incluye|incorpora|pon|pongas|ponme|aparece|aniade|añadir|anadir";
  const captured = getActionSegment(text, actionWords);
  const cleaned = limpiarPoiName(captured || text)
    .replace(/\b(?:mejor|mejores|valora|valores|valorado|valorada|valorados|valoradas|cercano|cercana|cercanos|cercanas|tipo|cosas|alguna|alguno|algo|otro|otra|diferente|alternativa)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const t = normalizar(text);
  if (cleaned && !["poi", "pois", "punto", "sitio", "lugar"].includes(cleaned)) return cleaned;

  if (t.includes("playa")) return "playa";
  if (t.includes("gastronom")) return "gastronomía";
  if (t.includes("naturaleza")) return "naturaleza";
  if (t.includes("museo")) return "museo";
  if (t.includes("mirador")) return "mirador";
  return "destacado turístico";
}

function extractSwapPositions(text: string): { fromIndex: number; toIndex: number } | null {
  const t = normalizar(text);
  const nums = [...t.matchAll(/(?:posicion|posición|parada)?\s*(\d+)/g)].map((m) => Number(m[1]));
  if (nums.length >= 2) return { fromIndex: nums[0] - 1, toIndex: nums[1] - 1 };
  return null;
}

async function crearMensaje(idConversacion: number, rol: "user" | "assistant", contenido: string) {
  return prisma.mensaje.create({
    data: { id_conversacion: idConversacion, rol, contenido, creado: new Date() },
  });
}

function respuestaConDetalle(texto: string, itinerario: any, dayNumber: number) {
  return `${texto}\n\nDía ${dayNumber} actualizado:\n${resumenDiaActualizado(itinerario, dayNumber)}`;
}

type PoiRecomendadoLibre = {
  id_poi: number;
  nombre: string;
  tipo: string | null;
  subcategoria: string | null;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
  descripcion: string | null;
  google_search_url: string | null;
  municipio?: { nombre?: string | null; provincia?: { nombre?: string | null; comunidad?: { nombre?: string | null } | null } | null } | null;
  categoria_poi?: { nombre?: string | null } | null;
};

const DESTINOS_CONOCIDOS = [
  "Madrid", "Barcelona", "Valencia", "Sevilla", "Málaga", "Malaga", "Granada", "Córdoba", "Cordoba",
  "Bilbao", "San Sebastián", "San Sebastian", "Zaragoza", "Toledo", "Salamanca", "Valladolid", "Alicante",
  "Murcia", "Cádiz", "Cadiz", "Santander", "Oviedo", "Gijón", "Gijon", "A Coruña", "Coruña", "Santiago",
  "Tenerife", "Gran Canaria", "Canarias", "Baleares", "Mallorca", "Menorca", "Ibiza", "Formentera",
  "Pamplona", "Logroño", "Logrono", "Burgos", "León", "Leon", "Segovia", "Cuenca", "Cáceres", "Caceres",
  "Mérida", "Merida", "Huelva", "Jaén", "Jaen", "Almería", "Almeria", "Castellón", "Castellon"
];

function capitalizarBasico(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function extraerDestinoLibre(texto: string, accion?: AccionIaParseada | null): string | null {
  const fromIa = limpiarQueryIa(accion?.destination);
  if (fromIa) return fromIa;

  const original = texto.trim();
  const lower = normalizar(original);
  for (const destino of DESTINOS_CONOCIDOS) {
    if (lower.includes(normalizar(destino))) return destino;
  }

  const patrones = [
    /(?:estoy|estaré|estare|voy a estar|me encuentro|ando)\s+en\s+([a-záéíóúñü\s]+?)(?:\s+y\s|\s+para\s|\s+hoy\s|\s+mañana\s|\s+manana\s|\s+esta\s|[,.;]|$)/i,
    /(?:en|por|para)\s+([a-záéíóúñü\s]+?)(?:\s+y\s+necesito|\s+y\s+quiero|\s+necesito|\s+quiero|\s+hoy|\s+mañana|\s+manana|\s+esta|[,.;]|$)/i,
  ];

  for (const patron of patrones) {
    const match = original.match(patron);
    const value = match?.[1]?.trim();
    if (value && value.length >= 3) return capitalizarBasico(value);
  }

  return null;
}

function extraerCantidadLibre(texto: string, accion?: AccionIaParseada | null): number {
  const fromIa = toPositiveInt(accion?.quantity);
  if (fromIa) return Math.min(fromIa, 6);

  const t = normalizar(texto);
  const direct = t.match(/\b(\d+)\s*(?:sitios|lugares|pois|puntos|planes|recomendaciones|cosas)?\b/);
  if (direct?.[1]) return Math.min(Math.max(Number(direct[1]), 1), 6);

  const words: Record<string, number> = { uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
  for (const [word, number] of Object.entries(words)) {
    if (new RegExp(`\\b${word}\\b`).test(t)) return number;
  }
  return 3;
}

function extraerConsultaLibre(texto: string, accion?: AccionIaParseada | null): string {
  const queryIa = limpiarQueryIa(accion?.query);
  if (queryIa && !["sitios", "sitios destacados", "lugares", "lugares destacados"].includes(normalizar(queryIa))) return queryIa;

  const t = normalizar(texto);
  const intereses: string[] = [];
  if (/\b(museo|museos|arte|cultura|cultural|monumento|monumentos|patrimonio|historia|historico|histórico)\b/.test(t)) intereses.push("cultura");
  if (/\b(comer|comida|gastronomia|gastronómico|gastronomico|restaurante|tapas|mercado)\b/.test(t)) intereses.push("gastronomía");
  if (/\b(playa|cala|mar|costa)\b/.test(t)) intereses.push("playa");
  if (/\b(parque|jardin|jardín|mirador|naturaleza|sendero|montaña|montana|paisaje)\b/.test(t)) intereses.push("naturaleza");
  if (/\b(tarde|hoy|rápido|rapido|cerca|cercano|poco tiempo)\b/.test(t)) intereses.push("cercano");
  return intereses.length ? intereses.join(" ") : "destacado turístico";
}

function construirWhereDestino(destino: string) {
  return {
    OR: [
      { municipio: { is: { nombre: { contains: destino, mode: "insensitive" as const } } } },
      { municipio: { is: { provincia: { is: { nombre: { contains: destino, mode: "insensitive" as const } } } } } },
      { municipio: { is: { provincia: { is: { comunidad: { is: { nombre: { contains: destino, mode: "insensitive" as const } } } } } } } },
      { nombre: { contains: destino, mode: "insensitive" as const } },
      { direccion: { contains: destino, mode: "insensitive" as const } },
    ],
  };
}

function construirWhereConsulta(query: string) {
  const q = query.trim();
  if (!q || normalizar(q) === "destacado turistico") return {};

  const tokens = q
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3)
    .slice(0, 5);

  if (!tokens.length) return {};

  return {
    OR: tokens.flatMap((token) => [
      { nombre: { contains: token, mode: "insensitive" as const } },
      { tipo: { contains: token, mode: "insensitive" as const } },
      { subcategoria: { contains: token, mode: "insensitive" as const } },
      { descripcion: { contains: token, mode: "insensitive" as const } },
      { categoria_poi: { is: { nombre: { contains: token, mode: "insensitive" as const } } } },
    ]),
  };
}

function puntuacionPoiLibre(poi: PoiRecomendadoLibre, query: string): number {
  const text = normalizar([poi.nombre, poi.tipo, poi.subcategoria, poi.descripcion, poi.categoria_poi?.nombre].filter(Boolean).join(" "));
  const q = normalizar(query);
  let score = 0;
  if (poi.latitud != null && poi.longitud != null) score += 8;
  if (poi.descripcion && poi.descripcion.length > 80) score += 5;
  if (poi.google_search_url) score += 2;
  if (poi.nombre && q && text.includes(q)) score += 10;
  for (const token of q.split(/\s+/).filter((x) => x.length >= 3)) {
    if (text.includes(token)) score += 3;
  }
  return score;
}

function formatearPoiLibre(poi: PoiRecomendadoLibre, index: number): string {
  const municipio = poi.municipio?.nombre;
  const provincia = poi.municipio?.provincia?.nombre;
  const categoria = poi.categoria_poi?.nombre ?? poi.tipo ?? poi.subcategoria ?? "recurso turístico";
  const lugar = [municipio, provincia].filter(Boolean).join(", ");
  const desc = poi.descripcion ? `\n   ${poi.descripcion.slice(0, 170)}${poi.descripcion.length > 170 ? "..." : ""}` : "";
  return `${index}. ${poi.nombre}${lugar ? ` (${lugar})` : ""}\n   Tipo: ${categoria}.${desc}`;
}

async function buscarRecomendacionesLibres(contenido: string, accion?: AccionIaParseada | null) {
  const destino = extraerDestinoLibre(contenido, accion);
  const cantidad = extraerCantidadLibre(contenido, accion);
  const query = extraerConsultaLibre(contenido, accion);

  if (!destino) {
    return {
      destino: null,
      query,
      cantidad,
      pois: [] as PoiRecomendadoLibre[],
      respuesta: "Claro. Dime en qué ciudad o zona estás y cuánto tiempo tienes. Por ejemplo: “Estoy en Madrid y quiero dos sitios para ver hoy por la tarde”.",
    };
  }

  const whereDestino = construirWhereDestino(destino);
  const whereConsulta = construirWhereConsulta(query);
  const andFilters: any[] = [whereDestino];
  if (Object.keys(whereConsulta).length > 0) andFilters.push(whereConsulta);

  let pois = (await prisma.poi.findMany({
    where: {
      AND: andFilters,
      valido: { not: false },
    },
    include: {
      categoria_poi: true,
      municipio: { include: { provincia: { include: { comunidad: true } } } },
    },
    take: Math.max(cantidad * 8, 20),
  })) as PoiRecomendadoLibre[];

  if (!pois.length && normalizar(query) !== "destacado turistico") {
    pois = (await prisma.poi.findMany({
      where: {
        AND: [whereDestino],
        valido: { not: false },
      },
      include: {
        categoria_poi: true,
        municipio: { include: { provincia: { include: { comunidad: true } } } },
      },
      take: Math.max(cantidad * 8, 20),
    })) as PoiRecomendadoLibre[];
  }

  const seleccionados = pois
    .sort((a, b) => puntuacionPoiLibre(b, query) - puntuacionPoiLibre(a, query))
    .slice(0, cantidad);

  if (!seleccionados.length) {
    return {
      destino,
      query,
      cantidad,
      pois: [],
      respuesta: `No he encontrado POIs fiables para ${destino} con esa petición. Prueba con una zona más concreta o con una categoría como cultura, miradores, playa o gastronomía.`,
    };
  }

  const timeContext = accion?.time_context ? ` para ${accion.time_context}` : "";
  const respuesta = [
    `Te recomiendo ${seleccionados.length} ${seleccionados.length === 1 ? "sitio" : "sitios"} en ${destino}${timeContext}:`,
    "",
    ...seleccionados.map((poi, index) => formatearPoiLibre(poi, index + 1)),
    "",
    "Puedes abrirlos desde el mapa o crear un itinerario si quieres organizarlo por días.",
  ].join("\n");

  return { destino, query, cantidad, pois: seleccionados, respuesta };
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
      return reply.code(400).send({ message: "El contenido del mensaje es obligatorio" });
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
      if (!itinerario) {
        const accionIaLibre = await interpretarConIaExterna(contenido, null);
        const recomendacion = await buscarRecomendacionesLibres(contenido, accionIaLibre);
        const assistant = await crearMensaje(idConversacion, "assistant", recomendacion.respuesta);
        return {
          user,
          assistant,
          action: "recommendation",
          source: accionIaLibre?.used_external_llm ? "external_llm" : "internal_search",
          destino: recomendacion.destino,
          query: recomendacion.query,
          pois: recomendacion.pois,
        };
      }

      const days = getAllDayNumbers(contenido);
      const accionIa = await interpretarConIaExterna(contenido, itinerario);

      if (accionIa?.action === "move") {
        const fromDay = toPositiveInt(accionIa.fromDayNumber) ?? days[0] ?? 1;
        const toDay = toPositiveInt(accionIa.toDayNumber) ?? days[1] ?? fromDay;
        if (fromDay !== toDay) {
          const poiName = limpiarQueryIa(accionIa.poiName) || extractRemoveName(contenido);
          const result = await movePoiBetweenDays(itinerario.id_itinerario, fromDay, toDay, poiName);
          const assistant = await crearMensaje(
            idConversacion,
            "assistant",
            respuestaConDetalle(`He movido ${result.poiName} del día ${fromDay} al día ${toDay}.`, result.itinerario, toDay),
          );
          return { user, assistant, action: "move_poi", source: "external_llm", itinerario: result.itinerario };
        }
      }

      if (accionIa?.action === "replace") {
        const dayNumber = elegirDiaParaInsertar(itinerario, accionIa.dayNumber) || getDayNumberFromText(contenido) || 1;
        const oldPoiName = limpiarQueryIa(accionIa.oldPoiName || accionIa.poiName) || extractRemoveName(contenido);
        const query = limpiarQueryIa(accionIa.query) || extractInsertQuery(contenido);
        const result = await replacePoiInItinerary(itinerario.id_itinerario, dayNumber, { oldPoiName, query });
        const assistant = await crearMensaje(
          idConversacion,
          "assistant",
          respuestaConDetalle(`He cambiado ${result.oldPoiName} por ${result.poi.nombre} en el día ${dayNumber}.`, result.itinerario, dayNumber),
        );
        return { user, assistant, action: "replace_poi", source: "external_llm", itinerario: result.itinerario };
      }

      if (accionIa?.action === "remove") {
        const dayNumber = elegirDiaParaInsertar(itinerario, accionIa.dayNumber) || getDayNumberFromText(contenido) || 1;
        const poiName = limpiarQueryIa(accionIa.poiName || accionIa.oldPoiName) || extractRemoveName(contenido);
        const result = await removePoiFromItinerary(itinerario.id_itinerario, dayNumber, poiName);
        const assistant = await crearMensaje(idConversacion, "assistant", respuestaConDetalle(`He quitado ${result.poiName} del día ${dayNumber}.`, result.itinerario, dayNumber));
        return { user, assistant, action: "remove_poi", source: "external_llm", itinerario: result.itinerario };
      }

      if (accionIa?.action === "insert") {
        const dayNumber = elegirDiaParaInsertar(itinerario, accionIa.dayNumber);
        const query = limpiarQueryIa(accionIa.query || accionIa.poiName) || extractInsertQuery(contenido);
        const result = await insertPoiIntoItinerary(itinerario.id_itinerario, dayNumber, { query, poiName: query });
        const assistant = await crearMensaje(idConversacion, "assistant", respuestaConDetalle(`He añadido ${result.poi.nombre} al día ${dayNumber}.`, result.itinerario, dayNumber));
        return { user, assistant, action: "insert_poi", source: "external_llm", itinerario: result.itinerario, poi: result.poi };
      }

      if (accionIa?.action === "regenerate_day") {
        const dayNumber = elegirDiaParaInsertar(itinerario, accionIa.dayNumber) || getDayNumberFromText(contenido) || 1;
        const actualizado = await regeneratePartialDay(itinerario.id_itinerario, dayNumber, contenido);
        const assistant = await crearMensaje(
          idConversacion,
          "assistant",
          respuestaConDetalle(`He regenerado solo el día ${dayNumber}. El resto del itinerario se mantiene igual.`, actualizado, dayNumber),
        );
        return { user, assistant, action: "regenerate_day", source: "external_llm", itinerario: actualizado };
      }

      if (hasMove(contenido) && days.length >= 2) {
        const fromDay = days[0];
        const toDay = days[1];
        const poiName = extractRemoveName(contenido);
        const result = await movePoiBetweenDays(itinerario.id_itinerario, fromDay, toDay, poiName);
        const assistant = await crearMensaje(
          idConversacion,
          "assistant",
          respuestaConDetalle(`He movido ${result.poiName} del día ${fromDay} al día ${toDay}.`, result.itinerario, toDay),
        );
        return { user, assistant, action: "move_poi", itinerario: result.itinerario };
      }

      if (hasSwap(contenido)) {
        const dayNumber = getDayNumberFromText(contenido) ?? 1;
        const positions = extractSwapPositions(contenido);
        if (!positions) {
          throw new Error("Para intercambiar POIs dime las posiciones. Ejemplo: intercambia la parada 1 y 3 del día 2.");
        }
        const actualizado = await swapPoisInDay(itinerario.id_itinerario, dayNumber, positions.fromIndex, positions.toIndex);
        const assistant = await crearMensaje(idConversacion, "assistant", respuestaConDetalle(`He cambiado el orden del día ${dayNumber}.`, actualizado, dayNumber));
        return { user, assistant, action: "swap_poi", itinerario: actualizado };
      }

      if (hasReplace(contenido)) {
        const dayNumber = getDayNumberFromText(contenido) ?? 1;
        const oldPoiName = extractRemoveName(contenido);
        const query = extractInsertQuery(contenido);
        const result = await replacePoiInItinerary(itinerario.id_itinerario, dayNumber, { oldPoiName, query });
        const assistant = await crearMensaje(
          idConversacion,
          "assistant",
          respuestaConDetalle(`He cambiado ${result.oldPoiName} por ${result.poi.nombre} en el día ${dayNumber}.`, result.itinerario, dayNumber),
        );
        return { user, assistant, action: "replace_poi", itinerario: result.itinerario };
      }

      if (hasRemove(contenido)) {
        const dayNumber = getDayNumberFromText(contenido) ?? 1;
        const poiName = extractRemoveName(contenido);
        const result = await removePoiFromItinerary(itinerario.id_itinerario, dayNumber, poiName);
        const assistant = await crearMensaje(idConversacion, "assistant", respuestaConDetalle(`He quitado ${result.poiName} del día ${dayNumber}.`, result.itinerario, dayNumber));
        return { user, assistant, action: "remove_poi", itinerario: result.itinerario };
      }

      if (hasInsert(contenido)) {
        const dayNumber = getDayNumberFromText(contenido) ?? 1;
        const query = extractInsertQuery(contenido);
        const result = await insertPoiIntoItinerary(itinerario.id_itinerario, dayNumber, { query, poiName: query });
        const assistant = await crearMensaje(idConversacion, "assistant", respuestaConDetalle(`He añadido ${result.poi.nombre} al día ${dayNumber}.`, result.itinerario, dayNumber));
        return { user, assistant, action: "insert_poi", itinerario: result.itinerario, poi: result.poi };
      }

      if (hasRegenerate(contenido)) {
        const dayNumber = getDayNumberFromText(contenido) ?? 1;
        const actualizado = await regeneratePartialDay(itinerario.id_itinerario, dayNumber, contenido);
        const assistant = await crearMensaje(
          idConversacion,
          "assistant",
          respuestaConDetalle(`He regenerado solo el día ${dayNumber}. El resto del itinerario se mantiene igual.`, actualizado, dayNumber),
        );
        return { user, assistant, action: "regenerate_day", itinerario: actualizado };
      }

      const assistant = await crearMensaje(
        idConversacion,
        "assistant",
        "No he modificado nada porque necesito una orden más concreta. Prueba así: “quita Plaza Mayor del día 2”, “añade 2 POIs al día 3” o “cambia Puerta del Sol del día 2 por otro diferente”.",
      );
      return { user, assistant, action: "no_action" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo aplicar el cambio.";
      const assistant = await crearMensaje(idConversacion, "assistant", `No he podido modificar el itinerario: ${message}`);
      return reply.code(200).send({ user, assistant, action: "error", error: message });
    }
  });
}

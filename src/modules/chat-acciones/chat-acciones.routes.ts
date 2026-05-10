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
        const assistant = await crearMensaje(
          idConversacion,
          "assistant",
          "Esta conversación no tiene un itinerario asociado. Abre el chat desde un itinerario guardado para poder modificarlo.",
        );
        return { user, assistant, action: "no_itinerary" };
      }

      const days = getAllDayNumbers(contenido);

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

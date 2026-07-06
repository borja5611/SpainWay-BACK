import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

// Nº máximo de instantáneas de trazabilidad conservadas por itinerario
// (Fase 13): evita que `ia_json.audit_history` crezca sin límite tras muchas
// ediciones manuales.
const MAX_AUDIT_HISTORY_ENTRIES = 10;

/**
 * Antes de sobrescribir `ia_json` con los días ya editados manualmente,
 * conserva una instantánea de la trazabilidad explicable (`engine_metadata`
 * + `decision_trace` + `quality_metrics`) que tenía el itinerario justo antes
 * de esta edición, bajo `audit_history`. Así no se pierde la evidencia de
 * cómo generó el motor la versión original, aunque el usuario edite el
 * itinerario después.
 */
function appendAuditHistorySnapshot(previousIaJson: any, nextIaJson: any): any {
  if (!previousIaJson || typeof previousIaJson !== "object") return nextIaJson;
  const hadTrace = previousIaJson.engine_metadata || previousIaJson.decision_trace;
  if (!hadTrace) return nextIaJson;

  const snapshot = {
    snapshotted_at: new Date().toISOString(),
    engine_metadata: previousIaJson.engine_metadata ?? null,
    decision_trace: previousIaJson.decision_trace ?? null,
    quality_metrics: previousIaJson.quality_metrics ?? null,
  };

  const priorHistory = Array.isArray(previousIaJson.audit_history) ? previousIaJson.audit_history : [];
  const history = [...priorHistory, snapshot].slice(-MAX_AUDIT_HISTORY_ENTRIES);

  return { ...nextIaJson, audit_history: history };
}

export type ManualItineraryAction =
  | { action: "remove"; dayNumber: number; poiId?: number; poiName?: string }
  | { action: "insert"; dayNumber: number; index?: number; poiId?: number; poiGlobalId?: string; poiName?: string; query?: string }
  | { action: "swap"; dayNumber: number; fromIndex: number; toIndex: number }
  | { action: "move"; fromDayNumber: number; toDayNumber: number; poiId?: number; poiName?: string; index?: number }
  | { action: "replace"; dayNumber: number; oldPoiId?: number; oldPoiName?: string; newPoiId?: number; newPoiGlobalId?: string; newPoiName?: string; query?: string };

export const includeItinerarioCompletoEdicion = {
  dias: {
    orderBy: { fecha: "asc" as const },
    include: {
      elementos: {
        orderBy: [{ orden: "asc" as const }, { id_elemento_itinerario: "asc" as const }],
        include: {
          poi: {
            include: {
              municipio: { include: { provincia: { include: { comunidad: true } } } },
              categoria_poi: true,
              destacados_ccaa: true,
            },
          },
        },
      },
      eventos: { include: { evento_turistico: true } },
    },
  },
  eventos: { include: { evento_turistico: true } },
};

function normalizar(value?: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function poiToSearchText(poi: any): string {
  return [
    poi?.nombre,
    poi?.tipo,
    poi?.subcategoria,
    poi?.direccion,
    poi?.descripcion,
    poi?.categoria_poi?.nombre,
    poi?.municipio?.nombre,
    poi?.municipio?.provincia?.nombre,
    poi?.municipio?.provincia?.comunidad?.nombre,
    ...(poi?.destacados_ccaa ?? []).map((d: any) => `${d.comunidad ?? ""} ${d.poi_canonico ?? ""} ${d.motivo ?? ""}`),
  ]
    .filter(Boolean)
    .join(" ");
}

function getDestinoPoiWhere(destino?: string | null): any {
  const d = normalizar(destino);
  if (!d) return {};

  if (d.includes("valencia") || d.includes("valenciana") || d.includes("alicante") || d.includes("castellon")) {
    return {
      OR: [
        { direccion: { contains: "Valencia", mode: "insensitive" as const } },
        { direccion: { contains: "Alicante", mode: "insensitive" as const } },
        { direccion: { contains: "Castellón", mode: "insensitive" as const } },
        { direccion: { contains: "Castellon", mode: "insensitive" as const } },
        { municipio: { provincia: { comunidad: { nombre: { contains: "Valenciana", mode: "insensitive" as const } } } } },
        { destacados_ccaa: { some: { comunidad: { contains: "valencia", mode: "insensitive" as const } } } },
      ],
    };
  }

  if (d.includes("madrid")) {
    return {
      OR: [
        { direccion: { contains: "Madrid", mode: "insensitive" as const } },
        { municipio: { nombre: { contains: "Madrid", mode: "insensitive" as const } } },
        { municipio: { provincia: { comunidad: { nombre: { contains: "Madrid", mode: "insensitive" as const } } } } },
        { destacados_ccaa: { some: { comunidad: { contains: "madrid", mode: "insensitive" as const } } } },
      ],
    };
  }

  const comunidades: Array<{ keys: string[]; comunidad: string }> = [
    { keys: ["andalucia", "malaga", "sevilla", "granada", "cordoba", "cadiz", "huelva", "jaen", "almeria"], comunidad: "Andalucía" },
    { keys: ["asturias", "oviedo", "gijon"], comunidad: "Asturias" },
    { keys: ["baleares", "mallorca", "menorca", "ibiza", "formentera"], comunidad: "Baleares" },
    { keys: ["canarias", "tenerife", "gran canaria", "lanzarote", "fuerteventura", "la palma"], comunidad: "Canarias" },
    { keys: ["cantabria", "santander"], comunidad: "Cantabria" },
    { keys: ["cataluna", "catalunya", "barcelona", "girona", "tarragona", "lleida"], comunidad: "Cataluña" },
  ];

  const match = comunidades.find((item) => item.keys.some((key) => d.includes(key)));
  if (!match) return {};

  return {
    OR: [
      { municipio: { provincia: { comunidad: { nombre: { contains: match.comunidad, mode: "insensitive" as const } } } } },
      { destacados_ccaa: { some: { comunidad: { contains: match.comunidad, mode: "insensitive" as const } } } },
    ],
  };
}

function inferirPreferencias(value?: string | null): string[] {
  const t = normalizar(value);
  const prefs: string[] = [];
  if (/\b(playa|playas|costa|mar|maritimo|maritima|marítimo|marítima|caleta|cala)\b/.test(t)) prefs.push("playa", "costa", "mar", "cala", "paseo marítimo");
  if (/\b(gastronomia|gastronomico|comida|tapas|mercado|restaurante)\b/.test(t)) prefs.push("gastronomía", "mercado", "restaurante", "tapas");
  if (/\b(naturaleza|parque|jardin|jardín|mirador|sendero)\b/.test(t)) prefs.push("naturaleza", "parque", "jardín", "mirador");
  if (/\b(museo|cultura|cultural|monumento|historia|arte|arquitectura)\b/.test(t)) prefs.push("museo", "cultura", "monumento", "historia", "arte", "arquitectura");
  return prefs.length ? prefs : [t || "turístico", "destacado", "monumento", "mirador"];
}

function pidePlaya(value?: string | null): boolean {
  return /\b(playa|playas|costa|mar|maritimo|maritima|marítimo|marítima|cala|caleta)\b/.test(normalizar(value));
}

function destinoNoTienePlaya(destino?: string | null): boolean {
  const d = normalizar(destino);
  return d.includes("madrid");
}

function fuzzyScore(candidate: string, query?: string | null): number {
  const c = normalizar(candidate);
  const q = normalizar(query);
  if (!c || !q) return 0;
  if (c === q) return 100;
  if (c.includes(q) || q.includes(c)) return 85;

  const tokens = q.split(/\s+/).filter((item) => item.length >= 3);
  if (!tokens.length) return 0;
  const hits = tokens.filter((token) => c.includes(token)).length;
  return Math.round((hits / tokens.length) * 75);
}

function limpiarQueryPoi(value?: string | null): string {
  return normalizar(value)
    .replace(/\b(?:poi|pois|punto|puntos|sitio|sitios|lugar|lugares|nuevo|nueva|nuevos|nuevas|otro|otra|diferente|alternativa|ese|esa|este|esta|dia|día|al|del|de|la|el|los|las|un|una|unos|unas|porfa|favor)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function esPeticionGenerica(value?: string | null): boolean {
  const q = limpiarQueryPoi(value);
  return !q || ["turistico", "turistica", "destacado", "destacada", "recomendacion", "recomendaciones"].includes(q);
}

function getElementoMasParecido(dia: any, poiName?: string | null, poiId?: number | null) {
  if (poiId) {
    return dia?.elementos?.find((elemento: any) => elemento.id_poi === poiId) ?? null;
  }

  const query = normalizar(poiName);
  if (!query) return null;

  const ranked = [...(dia?.elementos ?? [])]
    .map((elemento: any) => ({
      elemento,
      score: Math.max(
        fuzzyScore(elemento.poi?.nombre ?? "", query),
        fuzzyScore(poiToSearchText(elemento.poi), query),
      ),
    }))
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.score >= 38 ? ranked[0].elemento : null;
}

export async function cargarItinerarioCompleto(idItinerario: number) {
  return prisma.itinerario.findUnique({
    where: { id_itinerario: idItinerario },
    include: includeItinerarioCompletoEdicion,
  });
}

export async function cargarItinerarioDeConversacion(idConversacion: number) {
  const conversacion = await prisma.conversacion.findUnique({
    where: { id_conversacion: idConversacion },
  });

  if (!conversacion) return null;

  if (conversacion.id_itinerario) {
    return cargarItinerarioCompleto(conversacion.id_itinerario);
  }

  return null;
}

function getDiaByNumber(itinerario: any, dayNumber: number) {
  const n = Number(dayNumber);
  if (!Number.isInteger(n) || n < 1) return null;
  return itinerario?.dias?.[n - 1] ?? null;
}

function getIaDays(iaJson: any): any[] {
  if (!iaJson) return [];
  if (Array.isArray(iaJson.day_plans)) return iaJson.day_plans;
  if (Array.isArray(iaJson.dias)) return iaJson.dias;
  return [];
}

function setIaDays(iaJson: any, days: any[]): any {
  const base = iaJson && typeof iaJson === "object" && !Array.isArray(iaJson) ? { ...iaJson } : {};
  if (Array.isArray(base.dias) && !Array.isArray(base.day_plans)) {
    base.dias = days;
  } else {
    base.day_plans = days;
  }
  return base;
}

function buildIaPoi(elemento: any) {
  const poi = elemento.poi;
  return {
    global_id: poi?.id_global,
    id_global: poi?.id_global,
    name: poi?.nombre ?? "POI",
    nombre: poi?.nombre ?? "POI",
    reason: poi?.descripcion ?? "POI ajustado manualmente desde el chat.",
    motivo: poi?.descripcion ?? "POI ajustado manualmente desde el chat.",
    google_search_url: poi?.google_search_url ?? null,
    image_url: poi?.destacados_ccaa?.find((item: any) => item.imagen_url)?.imagen_url ?? null,
  };
}

async function syncIaJsonFromDb(idItinerario: number) {
  const itinerario = await cargarItinerarioCompleto(idItinerario);
  if (!itinerario) return null;

  const oldDays = getIaDays(itinerario.ia_json);
  const nextDays = itinerario.dias.map((dia: any, index: number) => {
    const oldDay = oldDays[index] ?? {};
    const pois = (dia.elementos ?? []).map(buildIaPoi);

    return {
      ...oldDay,
      day_number: oldDay.day_number ?? oldDay.dia ?? index + 1,
      dia: oldDay.dia ?? oldDay.day_number ?? index + 1,
      theme: oldDay.theme ?? oldDay.titulo ?? dia.notas?.split("|")[0]?.trim() ?? `Día ${index + 1}`,
      titulo: oldDay.titulo ?? oldDay.theme ?? dia.notas?.split("|")[0]?.trim() ?? `Día ${index + 1}`,
      total_minutes: dia.minutos ?? oldDay.total_minutes ?? oldDay.minutos ?? null,
      minutos: dia.minutos ?? oldDay.minutos ?? oldDay.total_minutes ?? null,
      pois,
      items: pois,
    };
  });

  const ia_json = appendAuditHistorySnapshot(
    itinerario.ia_json,
    setIaDays(itinerario.ia_json, nextDays),
  );

  await prisma.itinerario.update({
    where: { id_itinerario: idItinerario },
    data: {
      ia_json: ia_json as unknown as Prisma.InputJsonValue,
      actualizado: new Date(),
    },
  });

  return cargarItinerarioCompleto(idItinerario);
}

async function reordenarDia(idDiaItinerario: number) {
  const elementos = await prisma.elemento_Itinerario.findMany({
    where: { id_dia_itinerario: idDiaItinerario },
    orderBy: [{ orden: "asc" }, { id_elemento_itinerario: "asc" }],
  });

  await Promise.all(
    elementos.map((elemento, index) =>
      prisma.elemento_Itinerario.update({
        where: { id_elemento_itinerario: elemento.id_elemento_itinerario },
        data: { orden: index + 1 },
      }),
    ),
  );
}

export function resumenDiaActualizado(itinerario: any, dayNumber: number): string {
  const dia = getDiaByNumber(itinerario, dayNumber);
  const nombres = dia?.elementos?.map((elemento: any) => elemento.poi?.nombre).filter(Boolean) ?? [];
  if (!nombres.length) return `Día ${dayNumber} sin POIs.`;
  return nombres.map((nombre: string, index: number) => `${index + 1}. ${nombre}`).join("\n");
}

export async function removePoiFromItinerary(idItinerario: number, dayNumber: number, poiName?: string, poiId?: number) {
  const itinerario = await cargarItinerarioCompleto(idItinerario);
  if (!itinerario) throw new Error("Itinerario no encontrado");

  const dia = getDiaByNumber(itinerario, dayNumber);
  if (!dia) throw new Error(`No existe el día ${dayNumber} en este itinerario`);

  const elemento = getElementoMasParecido(dia, poiName, poiId);
  if (!elemento) {
    const nombres = dia.elementos.map((item: any) => item.poi?.nombre).filter(Boolean).join(", ");
    throw new Error(`No he encontrado "${poiName || "ese POI"}" en el día ${dayNumber}. POIs actuales: ${nombres || "sin POIs"}.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.elemento_Itinerario.delete({ where: { id_elemento_itinerario: elemento.id_elemento_itinerario } });
    await tx.itinerario.update({ where: { id_itinerario: idItinerario }, data: { actualizado: new Date() } });
  });

  await reordenarDia(dia.id_dia_itinerario);
  const actualizado = await syncIaJsonFromDb(idItinerario);
  return { itinerario: actualizado, poiName: elemento.poi?.nombre ?? poiName ?? "POI" };
}

async function buscarPoiParaInsertar(itinerario: any, query?: string | null, poiId?: number, poiGlobalId?: string | null) {
  if (poiId) return prisma.poi.findUnique({ where: { id_poi: poiId } });
  if (poiGlobalId) return prisma.poi.findUnique({ where: { id_global: poiGlobalId } });

  const rawQueryOriginal = query?.trim() || "";
  const rawQuery = limpiarQueryPoi(rawQueryOriginal) || rawQueryOriginal;
  const preferencias = inferirPreferencias(rawQuery || rawQueryOriginal);

  if (pidePlaya(rawQuery) && destinoNoTienePlaya(itinerario.destino)) {
    throw new Error(`${itinerario.destino ?? "Ese destino"} no tiene playas reales en la base de datos. No voy a inventar una playa.`);
  }

  const destinoWhere = getDestinoPoiWhere(itinerario.destino);

  if (rawQuery && !esPeticionGenerica(rawQuery)) {
    const posiblesExactos = await prisma.poi.findMany({
      where: {
        valido: { not: false },
        AND: [
          destinoWhere,
          {
            OR: [
              { nombre: { contains: rawQuery, mode: "insensitive" as const } },
              { id_global: { contains: rawQuery, mode: "insensitive" as const } },
            ],
          },
        ],
      },
      include: {
        municipio: { include: { provincia: { include: { comunidad: true } } } },
        categoria_poi: true,
        destacados_ccaa: true,
      },
      take: 80,
    });

    const usadosExactos = new Set(
      itinerario.dias.flatMap((dia: any) =>
        dia.elementos.map((elemento: any) => normalizar(elemento.poi?.id_global || String(elemento.id_poi))),
      ),
    );

    const exacto = posiblesExactos
      .filter((poi: any) => !usadosExactos.has(normalizar(poi.id_global || String(poi.id_poi))))
      .map((poi: any) => ({ poi, score: Math.max(fuzzyScore(poi.nombre ?? "", rawQuery), fuzzyScore(poiToSearchText(poi), rawQuery)) }))
      .sort((a, b) => b.score - a.score)[0];

    if (exacto?.score >= 55) return exacto.poi;
  }

  const textWhere = {
    OR: [
      { nombre: { contains: rawQuery, mode: "insensitive" as const } },
      { tipo: { contains: rawQuery, mode: "insensitive" as const } },
      { subcategoria: { contains: rawQuery, mode: "insensitive" as const } },
      { descripcion: { contains: rawQuery, mode: "insensitive" as const } },
      { direccion: { contains: rawQuery, mode: "insensitive" as const } },
      { categoria_poi: { nombre: { contains: rawQuery, mode: "insensitive" as const } } },
      ...preferencias.flatMap((pref) => [
        { nombre: { contains: pref, mode: "insensitive" as const } },
        { tipo: { contains: pref, mode: "insensitive" as const } },
        { subcategoria: { contains: pref, mode: "insensitive" as const } },
        { descripcion: { contains: pref, mode: "insensitive" as const } },
        { categoria_poi: { nombre: { contains: pref, mode: "insensitive" as const } } },
      ]),
    ],
  };

  const usados = new Set(
    itinerario.dias.flatMap((dia: any) =>
      dia.elementos.map((elemento: any) => normalizar(elemento.poi?.id_global || String(elemento.id_poi))),
    ),
  );

  const pois = await prisma.poi.findMany({
    where: { valido: { not: false }, AND: [destinoWhere, textWhere] },
    include: {
      municipio: { include: { provincia: { include: { comunidad: true } } } },
      categoria_poi: true,
      destacados_ccaa: true,
    },
    take: 1200,
  });

  const baseLat = itinerario.base_latitud ?? null;
  const baseLon = itinerario.base_longitud ?? null;
  const requierePlaya = pidePlaya(rawQuery);

  const candidatos = pois
    .filter((poi: any) => !usados.has(normalizar(poi.id_global || String(poi.id_poi))))
    .map((poi: any) => {
      const texto = normalizar(poiToSearchText(poi));
      const prefScore = preferencias.reduce((acc, pref) => acc + (texto.includes(normalizar(pref)) ? 1 : 0), 0);
      const queryScore = rawQuery && texto.includes(normalizar(rawQuery)) ? 3 : 0;
      const playaScore = requierePlaya && /\b(playa|costa|mar|maritimo|maritima|marítimo|marítima|cala|caleta)\b/.test(texto) ? 9 : 0;
      const destacadoBoost = poi.destacados_ccaa?.length ? 1.5 : 0;
      const distanceKm = baseLat && baseLon && poi.latitud && poi.longitud ? haversineKm(Number(baseLat), Number(baseLon), Number(poi.latitud), Number(poi.longitud)) : 0;
      const score = playaScore + queryScore + prefScore * 2 + destacadoBoost + (poi.puntuacion ?? 0) + (poi.popularidad ?? 0) / 100 - distanceKm / 25;
      return { poi, score, prefScore, queryScore, playaScore };
    })
    .filter((item) => !requierePlaya || item.playaScore > 0)
    .filter((item) => item.prefScore > 0 || item.queryScore > 0 || item.playaScore > 0)
    .sort((a, b) => b.score - a.score);

  return candidatos[0]?.poi ?? null;
}

export async function insertPoiIntoItinerary(idItinerario: number, dayNumber: number, options: { index?: number; poiId?: number; poiGlobalId?: string; poiName?: string; query?: string }) {
  const itinerario = await cargarItinerarioCompleto(idItinerario);
  if (!itinerario) throw new Error("Itinerario no encontrado");

  const dia = getDiaByNumber(itinerario, dayNumber);
  if (!dia) throw new Error(`No existe el día ${dayNumber} en este itinerario`);

  const query = options.query || options.poiName || "";
  const poi = await buscarPoiParaInsertar(itinerario, query, options.poiId, options.poiGlobalId);
  if (!poi) throw new Error(`No he encontrado ningún POI real para "${query || "tu petición"}" dentro de ${itinerario.destino ?? "este destino"}. No he guardado ningún cambio.`);

  const elementos = [...dia.elementos].sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0));
  const index = Math.max(0, Math.min(Number(options.index ?? elementos.length), elementos.length));

  const creado = await prisma.$transaction(async (tx) => {
    await Promise.all(
      elementos.slice(index).map((elemento: any) =>
        tx.elemento_Itinerario.update({
          where: { id_elemento_itinerario: elemento.id_elemento_itinerario },
          data: { orden: (elemento.orden ?? 0) + 1 },
        }),
      ),
    );

    const nuevo = await tx.elemento_Itinerario.create({
      data: { id_dia_itinerario: dia.id_dia_itinerario, id_poi: poi.id_poi, orden: index + 1, transporte: null, tiempo_transporte: null },
    });

    await tx.itinerario.update({ where: { id_itinerario: idItinerario }, data: { actualizado: new Date() } });
    return nuevo;
  });

  await reordenarDia(dia.id_dia_itinerario);
  const actualizado = await syncIaJsonFromDb(idItinerario);
  const existe = actualizado?.dias?.[dayNumber - 1]?.elementos?.some((elemento: any) => elemento.id_elemento_itinerario === creado.id_elemento_itinerario);
  if (!existe) throw new Error("El POI se ha creado, pero no aparece al recargar el itinerario.");

  return { itinerario: actualizado, poi };
}

export async function movePoiBetweenDays(idItinerario: number, fromDayNumber: number, toDayNumber: number, poiName?: string, poiId?: number, index?: number) {
  const itinerario = await cargarItinerarioCompleto(idItinerario);
  if (!itinerario) throw new Error("Itinerario no encontrado");

  const fromDia = getDiaByNumber(itinerario, fromDayNumber);
  const toDia = getDiaByNumber(itinerario, toDayNumber);
  if (!fromDia) throw new Error(`No existe el día ${fromDayNumber} en este itinerario`);
  if (!toDia) throw new Error(`No existe el día ${toDayNumber} en este itinerario`);

  const elemento = getElementoMasParecido(fromDia, poiName, poiId);
  if (!elemento) throw new Error(`No he encontrado "${poiName || "ese POI"}" en el día ${fromDayNumber}.`);

  const targetElements = [...toDia.elementos].sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0));
  const targetIndex = Math.max(0, Math.min(Number(index ?? targetElements.length), targetElements.length));

  await prisma.$transaction(async (tx) => {
    await tx.elemento_Itinerario.delete({ where: { id_elemento_itinerario: elemento.id_elemento_itinerario } });
    await Promise.all(
      targetElements.slice(targetIndex).map((item: any) =>
        tx.elemento_Itinerario.update({ where: { id_elemento_itinerario: item.id_elemento_itinerario }, data: { orden: (item.orden ?? 0) + 1 } }),
      ),
    );
    await tx.elemento_Itinerario.create({
      data: { id_dia_itinerario: toDia.id_dia_itinerario, id_poi: elemento.id_poi, orden: targetIndex + 1, transporte: null, tiempo_transporte: null },
    });
    await tx.itinerario.update({ where: { id_itinerario: idItinerario }, data: { actualizado: new Date() } });
  });

  await reordenarDia(fromDia.id_dia_itinerario);
  await reordenarDia(toDia.id_dia_itinerario);
  return { itinerario: await syncIaJsonFromDb(idItinerario), poiName: elemento.poi?.nombre ?? poiName ?? "POI" };
}

export async function swapPoisInDay(idItinerario: number, dayNumber: number, fromIndex: number, toIndex: number) {
  const itinerario = await cargarItinerarioCompleto(idItinerario);
  if (!itinerario) throw new Error("Itinerario no encontrado");

  const dia = getDiaByNumber(itinerario, dayNumber);
  if (!dia) throw new Error(`No existe el día ${dayNumber} en este itinerario`);

  const elementos = [...dia.elementos].sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0));
  const from = Math.max(0, Number(fromIndex));
  const to = Math.max(0, Math.min(Number(toIndex), elementos.length - 1));
  if (!elementos[from] || !elementos[to]) throw new Error("Posiciones inválidas para intercambiar POIs.");

  const [moved] = elementos.splice(from, 1);
  elementos.splice(to, 0, moved);

  await Promise.all(
    elementos.map((elemento: any, index: number) =>
      prisma.elemento_Itinerario.update({ where: { id_elemento_itinerario: elemento.id_elemento_itinerario }, data: { orden: index + 1 } }),
    ),
  );

  await prisma.itinerario.update({ where: { id_itinerario: idItinerario }, data: { actualizado: new Date() } });
  return syncIaJsonFromDb(idItinerario);
}

function queryAlternativaDesdePoi(viejo: any, query?: string | null): string {
  const q = normalizar(query);

  // Si el usuario pide algo concreto, usamos esa preferencia.
  if (
    q &&
    !q.includes("otro diferente") &&
    !q.includes("otra diferente") &&
    !q.includes("algo diferente") &&
    !q.includes("alternativa") &&
    !q.includes("diferente")
  ) {
    return query?.trim() || "turístico";
  }

  return (
    viejo?.poi?.categoria_poi?.nombre ||
    viejo?.poi?.tipo ||
    viejo?.poi?.subcategoria ||
    "destacado turístico"
  );
}

export async function replacePoiInItinerary(idItinerario: number, dayNumber: number, options: { oldPoiName?: string; oldPoiId?: number; newPoiId?: number; newPoiGlobalId?: string; newPoiName?: string; query?: string }) {
  const itinerario = await cargarItinerarioCompleto(idItinerario);
  if (!itinerario) throw new Error("Itinerario no encontrado");

  const dia = getDiaByNumber(itinerario, dayNumber);
  if (!dia) throw new Error(`No existe el día ${dayNumber} en este itinerario`);

  const viejo = getElementoMasParecido(dia, options.oldPoiName, options.oldPoiId);
  if (!viejo) {
    const nombres = dia.elementos.map((item: any) => item.poi?.nombre).filter(Boolean).join(", ");
    throw new Error(`No he encontrado "${options.oldPoiName || "ese POI"}" en el día ${dayNumber}. POIs actuales: ${nombres || "sin POIs"}.`);
  }

  const query = queryAlternativaDesdePoi(viejo, options.query || options.newPoiName);
  const nuevoPoi = await buscarPoiParaInsertar(itinerario, query, options.newPoiId, options.newPoiGlobalId);
  if (!nuevoPoi) throw new Error(`No he encontrado un POI alternativo real para reemplazar ${viejo.poi?.nombre ?? "ese POI"}.`);

  if (nuevoPoi.id_poi === viejo.id_poi) {
    throw new Error("La alternativa encontrada coincide con el POI actual. No se ha guardado ningún cambio.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.elemento_Itinerario.update({ where: { id_elemento_itinerario: viejo.id_elemento_itinerario }, data: { id_poi: nuevoPoi.id_poi } });
    await tx.itinerario.update({ where: { id_itinerario: idItinerario }, data: { actualizado: new Date() } });
  });

  return { itinerario: await syncIaJsonFromDb(idItinerario), oldPoiName: viejo.poi?.nombre ?? options.oldPoiName ?? "POI", poi: nuevoPoi };
}

export async function applyManualItineraryAction(idItinerario: number, action: ManualItineraryAction) {
  if (action.action === "remove") return removePoiFromItinerary(idItinerario, action.dayNumber, action.poiName, action.poiId);
  if (action.action === "insert") return insertPoiIntoItinerary(idItinerario, action.dayNumber, action);
  if (action.action === "swap") return swapPoisInDay(idItinerario, action.dayNumber, action.fromIndex, action.toIndex);
  if (action.action === "move") return movePoiBetweenDays(idItinerario, action.fromDayNumber, action.toDayNumber, action.poiName, action.poiId, action.index);
  if (action.action === "replace") return replacePoiInItinerary(idItinerario, action.dayNumber, action);
  throw new Error("Acción manual no soportada");
}

export async function regeneratePartialDay(idItinerario: number, dayNumber: number, message: string) {
  const itinerario = await cargarItinerarioCompleto(idItinerario);
  if (!itinerario) throw new Error("Itinerario no encontrado");

  const dia = getDiaByNumber(itinerario, dayNumber);
  if (!dia) throw new Error(`No existe el día ${dayNumber} en este itinerario`);

  const preferencias = inferirPreferencias(message);
  const destinoWhere = getDestinoPoiWhere(itinerario.destino);
  const usadosOtrosDias = new Set(
    itinerario.dias.filter((d: any) => d.id_dia_itinerario !== dia.id_dia_itinerario).flatMap((d: any) => d.elementos.map((e: any) => normalizar(e.poi?.id_global || String(e.id_poi)))),
  );
  const cantidad = Math.max(2, Math.min(5, dia.elementos.length || 4));

  if (pidePlaya(message) && destinoNoTienePlaya(itinerario.destino)) {
    throw new Error(`${itinerario.destino ?? "Ese destino"} no tiene playas reales en la base de datos. No voy a regenerar el día inventando playas.`);
  }

  const prefsWhere = {
    OR: preferencias.flatMap((pref) => [
      { nombre: { contains: pref, mode: "insensitive" as const } },
      { tipo: { contains: pref, mode: "insensitive" as const } },
      { subcategoria: { contains: pref, mode: "insensitive" as const } },
      { descripcion: { contains: pref, mode: "insensitive" as const } },
      { categoria_poi: { nombre: { contains: pref, mode: "insensitive" as const } } },
    ]),
  };

  const pois = await prisma.poi.findMany({
    where: { valido: { not: false }, AND: [destinoWhere, prefsWhere] },
    include: { municipio: { include: { provincia: { include: { comunidad: true } } } }, categoria_poi: true, destacados_ccaa: true },
    take: 1200,
  });

  const baseLat = itinerario.base_latitud ?? dia.elementos[0]?.poi?.latitud ?? null;
  const baseLon = itinerario.base_longitud ?? dia.elementos[0]?.poi?.longitud ?? null;
  const requierePlaya = pidePlaya(message);

  const candidatos = pois
    .filter((poi: any) => !usadosOtrosDias.has(normalizar(poi.id_global || String(poi.id_poi))))
    .map((poi: any) => {
      const texto = normalizar(poiToSearchText(poi));
      const prefScore = preferencias.reduce((acc, pref) => acc + (texto.includes(normalizar(pref)) ? 1 : 0), 0);
      const playaScore = requierePlaya && /\b(playa|costa|mar|maritimo|maritima|marítimo|marítima|cala|caleta)\b/.test(texto) ? 8 : 0;
      const distanceKm = baseLat && baseLon && poi.latitud && poi.longitud ? haversineKm(Number(baseLat), Number(baseLon), Number(poi.latitud), Number(poi.longitud)) : 0;
      const score = prefScore * 2 + playaScore + (poi.puntuacion ?? 0) + (poi.popularidad ?? 0) / 100 + (poi.destacados_ccaa?.length ? 1 : 0) - distanceKm / 25;
      return { poi, score, playaScore };
    })
    .filter((item) => !requierePlaya || item.playaScore > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, cantidad);

  if (!candidatos.length) throw new Error("No he encontrado alternativas reales suficientes para regenerar ese día.");

  await prisma.$transaction(async (tx) => {
    await tx.elemento_Itinerario.deleteMany({ where: { id_dia_itinerario: dia.id_dia_itinerario } });
    for (let i = 0; i < candidatos.length; i += 1) {
      await tx.elemento_Itinerario.create({
        data: { id_dia_itinerario: dia.id_dia_itinerario, id_poi: candidatos[i].poi.id_poi, orden: i + 1, transporte: null, tiempo_transporte: null },
      });
    }
    await tx.dia_Itinerario.update({ where: { id_dia_itinerario: dia.id_dia_itinerario }, data: { notas: `Regenerado parcialmente desde chat: ${message}`.slice(0, 1000) } });
    await tx.itinerario.update({ where: { id_itinerario: idItinerario }, data: { actualizado: new Date() } });
  });

  return syncIaJsonFromDb(idItinerario);
}

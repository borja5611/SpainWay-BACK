import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { prisma } from "../../lib/prisma";

type QueryTiempo = {
  idItinerario?: string;
  id_itinerario?: string;
  destino?: string;
  destination?: string;
  inicio?: string;
  fin?: string;
  diaIso?: string;
  diasIso?: string;
  "díaIso"?: string;
  "díasIso"?: string;
  fecha?: string;
  lat?: string;
  lon?: string;
  latitude?: string;
  longitude?: string;
};

type ForecastDay = {
  fecha: string;
  tempMin: number | null;
  tempMax: number | null;
  lluvia: number | null;
  viento: number | null;
  descripcion: string;
  consejo: string;
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateOnly(value?: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isInsideForecastRange(dateIso: string): boolean {
  const today = todayIso();
  const last = addDaysIso(13);
  return dateIso >= today && dateIso <= last;
}

function weatherDescription(code: number | null): string {
  if (code === null) return "Previsión disponible";
  if (code === 0) return "Cielo despejado";
  if ([1, 2, 3].includes(code)) return "Nubes y claros";
  if ([45, 48].includes(code)) return "Niebla";
  if ([51, 53, 55, 56, 57].includes(code)) return "Llovizna";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Lluvia";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Nieve";
  if ([95, 96, 99].includes(code)) return "Tormenta";
  return "Previsión disponible";
}

function buildAdvice(day: ForecastDay): string {
  const lluvia = day.lluvia ?? 0;
  const max = day.tempMax ?? 0;
  const desc = day.descripcion.toLowerCase();

  if (lluvia >= 60 || desc.includes("lluvia") || desc.includes("tormenta")) {
    return "Probabilidad alta de lluvia. Prioriza museos, patrimonio cubierto, mercados o planes de interior.";
  }

  if (max >= 32) {
    return "Día caluroso. Mejor concentra visitas exteriores por la mañana o al atardecer y reserva interiores para las horas centrales.";
  }

  if (max <= 10) {
    return "Día frío. Conviene alternar exteriores cortos con visitas interiores y llevar abrigo.";
  }

  return "Condiciones razonables para combinar visitas exteriores e interiores.";
}

function seasonalOrientation(destination?: string | null, month?: number | null): string {
  const dest = (destination || "el destino").toLowerCase();
  const m = month ?? new Date().getMonth() + 1;

  if (dest.includes("canarias") || dest.includes("tenerife") || dest.includes("gran canaria") || dest.includes("lanzarote") || dest.includes("fuerteventura")) {
    return "Orientación estacional: clima generalmente templado durante todo el año, con buena viabilidad para planes de exterior. En zonas de cumbre puede cambiar rápido.";
  }

  if (dest.includes("cantabria") || dest.includes("asturias") || dest.includes("galicia") || dest.includes("país vasco") || dest.includes("pais vasco")) {
    return "Orientación estacional: clima atlántico suave y variable, con posibilidad de lluvia incluso en meses templados. Conviene combinar exterior con planes cubiertos.";
  }

  if (dest.includes("madrid") || dest.includes("sevilla") || dest.includes("córdoba") || dest.includes("cordoba")) {
    if ([6, 7, 8, 9].includes(m)) {
      return "Orientación estacional: probable calor en meses de verano. Recomendable evitar horas centrales y priorizar interiores o sombra al mediodía.";
    }
    return "Orientación estacional: clima de interior, con contraste entre estaciones. Suele ser viable combinar paseos urbanos y visitas culturales.";
  }

  if (dest.includes("valencia") || dest.includes("alicante") || dest.includes("málaga") || dest.includes("malaga") || dest.includes("baleares")) {
    return "Orientación estacional: clima mediterráneo, generalmente favorable para exterior, con más calor en verano y episodios de lluvia puntuales según la época.";
  }

  return "Orientación estacional aproximada: al estar fuera del rango fiable de previsión, se recomienda revisar el tiempo real unos días antes del viaje.";
}

async function geocodeDestination(destination: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", destination);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "es");
  url.searchParams.set("format", "json");
  url.searchParams.set("countryCode", "ES");

  const response = await fetch(url.toString());
  if (!response.ok) return null;

  const data = await response.json() as {
    results?: Array<{ latitude?: number; longitude?: number; name?: string; admin1?: string }>;
  };

  const first = data.results?.[0];
  if (!first?.latitude || !first?.longitude) return null;

  return {
    lat: Number(first.latitude),
    lon: Number(first.longitude),
    name: [first.name, first.admin1].filter(Boolean).join(", ") || destination,
  };
}

async function resolveContext(query: QueryTiempo): Promise<{
  lat: number | null;
  lon: number | null;
  destino: string | null;
  inicio: string | null;
  fin: string | null;
}> {
  let lat = toNumber(query.lat ?? query.latitude);
  let lon = toNumber(query.lon ?? query.longitude);
  let destino = query.destino || query.destination || null;
  let inicio = dateOnly(query.inicio);
  let fin = dateOnly(query.fin);

  const rawId = query.idItinerario ?? query.id_itinerario;
  const idItinerario = rawId ? Number(rawId) : null;

  if ((!lat || !lon || !destino || !inicio || !fin) && idItinerario && Number.isFinite(idItinerario)) {
    const itinerario = await (prisma as any).itinerario.findUnique({
      where: { id_itinerario: idItinerario },
      include: {
        dias: {
          orderBy: { fecha: "asc" },
          include: {
            elementos: {
              orderBy: { orden: "asc" },
              include: { poi: true },
            },
          },
        },
      },
    });

    if (itinerario) {
      destino = destino || itinerario.destino || itinerario.base_nombre || null;
      inicio = inicio || dateOnly(itinerario.inicio) || dateOnly(itinerario.dias?.[0]?.fecha);
      fin = fin || dateOnly(itinerario.fin) || dateOnly(itinerario.dias?.[itinerario.dias.length - 1]?.fecha);
      lat = lat ?? toNumber(itinerario.base_latitud);
      lon = lon ?? toNumber(itinerario.base_longitud);

      if (lat === null || lon === null) {
        for (const dia of itinerario.dias || []) {
          for (const elemento of dia.elementos || []) {
            const poi = elemento.poi;
            const poiLat = toNumber(poi?.latitud);
            const poiLon = toNumber(poi?.longitud);
            if (poiLat !== null && poiLon !== null) {
              lat = poiLat;
              lon = poiLon;
              break;
            }
          }
          if (lat !== null && lon !== null) break;
        }
      }
    }
  }

  if ((lat === null || lon === null) && destino) {
    const geo = await geocodeDestination(destino);
    if (geo) {
      lat = geo.lat;
      lon = geo.lon;
      destino = destino || geo.name;
    }
  }

  return { lat, lon, destino, inicio, fin };
}

async function fetchForecast(lat: number, lon: number): Promise<ForecastDay[]> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("forecast_days", "14");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "wind_speed_10m_max",
    ].join(",")
  );

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Open-Meteo respondió con ${response.status}`);
  }

  const data = await response.json() as {
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
      wind_speed_10m_max?: number[];
    };
  };

  const times = data.daily?.time || [];

  return times.map((fecha, index) => {
    const code = toNumber(data.daily?.weather_code?.[index]);
    const day: ForecastDay = {
      fecha,
      tempMin: toNumber(data.daily?.temperature_2m_min?.[index]),
      tempMax: toNumber(data.daily?.temperature_2m_max?.[index]),
      lluvia: toNumber(data.daily?.precipitation_probability_max?.[index]),
      viento: toNumber(data.daily?.wind_speed_10m_max?.[index]),
      descripcion: weatherDescription(code),
      consejo: "",
    };

    day.consejo = buildAdvice(day);
    return day;
  });
}

export default async function meteorologiaRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  app.get<{ Querystring: QueryTiempo }>("/contexto", async (request, reply) => {
    try {
      const query = request.query;
      const requestedDay = dateOnly(query.diaIso || query.diasIso || query["díaIso"] || query["díasIso"] || query.fecha);
      const context = await resolveContext(query);

      if (context.lat === null || context.lon === null) {
        return reply.code(200).send({
          ok: true,
          disponible: false,
          fiable: false,
          destino: context.destino || query.destino || query.destination || "Destino del itinerario",
          mensaje: "No se han encontrado coordenadas suficientes para consultar la previsión meteorológica.",
          dias: [],
          orientacion_estacional: seasonalOrientation(context.destino || query.destino || query.destination, null),
        });
      }

      const targetDates: string[] = [];
      if (requestedDay) {
        targetDates.push(requestedDay);
      } else {
        const start = context.inicio;
        const end = context.fin || context.inicio;
        if (start && end) {
          const cursor = new Date(start);
          const limit = new Date(end);
          while (!Number.isNaN(cursor.getTime()) && cursor <= limit && targetDates.length < 14) {
            targetDates.push(cursor.toISOString().slice(0, 10));
            cursor.setDate(cursor.getDate() + 1);
          }
        }
      }

      const hasDates = targetDates.length > 0;
      const allInsideRange = hasDates ? targetDates.every(isInsideForecastRange) : true;

      if (hasDates && !allInsideRange) {
        const firstMonth = targetDates[0] ? Number(targetDates[0].slice(5, 7)) : null;
        return reply.code(200).send({
          ok: true,
          disponible: false,
          fiable: false,
          destino: context.destino || query.destino || query.destination || "Destino del itinerario",
          mensaje: "La previsión meteorológica fiable solo está disponible para los próximos 14 días. Para esas fechas no se muestra una predicción exacta.",
          dias: [],
          orientacion_estacional: seasonalOrientation(context.destino || query.destino || query.destination, firstMonth),
        });
      }

      const forecast = await fetchForecast(context.lat, context.lon);
      const filtered = hasDates
        ? forecast.filter((day) => targetDates.includes(day.fecha))
        : forecast;

      return reply.code(200).send({
        ok: true,
        disponible: filtered.length > 0,
        fiable: true,
        destino: context.destino || query.destino || query.destination || "Destino del itinerario",
        mensaje: requestedDay
          ? "Previsión del día seleccionado."
          : "Previsión disponible para los próximos 14 días.",
        coordenadas: {
          lat: context.lat,
          lon: context.lon,
        },
        dias: filtered,
        orientacion_estacional: null,
      });
    } catch (error) {
      request.log.error({ error }, "Error consultando meteorología");
      return reply.code(200).send({
        ok: false,
        disponible: false,
        fiable: false,
        mensaje: "No se pudo consultar la meteorología ahora mismo. Inténtalo de nuevo más tarde.",
        dias: [],
      });
    }
  });
}

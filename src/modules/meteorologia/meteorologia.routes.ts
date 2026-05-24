
import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

type WeatherDay = {
  date: string;
  temp_min: number | null;
  temp_max: number | null;
  rain_probability: number | null;
  wind_max: number | null;
  weather_code: number | null;
  label: string;
  advice: string;
};

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function inNext14Days(value?: string | null): boolean {
  if (!value) return false;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  const today = todayUtc();
  const max = new Date(today.getTime() + 13 * 86400000);
  return date >= today && date <= max;
}

function weatherLabel(code: number | null): string {
  if (code === null) return "Sin clasificar";
  if ([0].includes(code)) return "Despejado";
  if ([1, 2, 3].includes(code)) return "Nubes y claros";
  if ([45, 48].includes(code)) return "Niebla";
  if ([51, 53, 55, 56, 57].includes(code)) return "Llovizna";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Lluvia";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Nieve";
  if ([95, 96, 99].includes(code)) return "Tormenta";
  return "Variable";
}

function adviceFor(label: string, rain: number | null, wind: number | null, max: number | null): string {
  const rainy = (rain ?? 0) >= 55 || ["Lluvia", "Tormenta", "Llovizna"].includes(label);
  if (rainy) return "Prioriza museos, patrimonio cubierto, mercados y planes de interior; deja miradores o parques para otra franja.";
  if ((max ?? 0) >= 32) return "Evita las horas centrales del día y prioriza visitas de mañana/tarde, sombra y pausas.";
  if ((wind ?? 0) >= 45) return "Puede haber viento fuerte; cuidado con miradores, costa y rutas expuestas.";
  return "Buen día para combinar exterior, paseo urbano y visitas culturales.";
}

async function resolverCoordenadas(idItinerario?: number, lat?: number, lon?: number) {
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat: Number(lat), lon: Number(lon) };
  if (!idItinerario) return null;

  const itinerario = await prisma.itinerario.findUnique({
    where: { id_itinerario: idItinerario },
    include: {
      dias: {
        include: { elementos: { include: { poi: true }, take: 1, orderBy: { orden: "asc" } } },
        take: 1,
        orderBy: { fecha: "asc" },
      },
    },
  });

  const baseLat = Number(itinerario?.base_latitud);
  const baseLon = Number(itinerario?.base_longitud);
  if (Number.isFinite(baseLat) && Number.isFinite(baseLon)) return { lat: baseLat, lon: baseLon };

  const poi = itinerario?.dias?.[0]?.elementos?.[0]?.poi;
  const poiLat = Number(poi?.latitud);
  const poiLon = Number(poi?.longitud);
  if (Number.isFinite(poiLat) && Number.isFinite(poiLon)) return { lat: poiLat, lon: poiLon };
  return null;
}

export default async function meteorologiaRoutes(app: FastifyInstance) {
  app.get("/forecast", async (request, reply) => {
    const query = request.query as { id_itinerario?: string; lat?: string; lon?: string; start?: string; end?: string };
    const idItinerario = Number(query.id_itinerario);
    const coords = await resolverCoordenadas(
      Number.isInteger(idItinerario) ? idItinerario : undefined,
      Number(query.lat),
      Number(query.lon),
    );

    if (!coords) {
      return reply.code(400).send({ ok: false, message: "No hay coordenadas suficientes para consultar el tiempo." });
    }

    const startInRange = inNext14Days(query.start);
    const endInRange = query.end ? inNext14Days(query.end) : startInRange;
    const reliable_for_trip = Boolean(startInRange && endInRange);

    const params = new URLSearchParams({
      latitude: String(coords.lat),
      longitude: String(coords.lon),
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max",
      forecast_days: "14",
      timezone: "auto",
    });

    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!response.ok) {
      return reply.code(502).send({ ok: false, message: "No se pudo consultar Open-Meteo." });
    }

    const data = await response.json() as any;
    const daily = data.daily ?? {};
    const times: string[] = Array.isArray(daily.time) ? daily.time : [];

    const days: WeatherDay[] = times.map((date, index) => {
      const code = typeof daily.weather_code?.[index] === "number" ? daily.weather_code[index] : null;
      const label = weatherLabel(code);
      const rain = typeof daily.precipitation_probability_max?.[index] === "number" ? daily.precipitation_probability_max[index] : null;
      const wind = typeof daily.wind_speed_10m_max?.[index] === "number" ? daily.wind_speed_10m_max[index] : null;
      const max = typeof daily.temperature_2m_max?.[index] === "number" ? daily.temperature_2m_max[index] : null;

      return {
        date,
        temp_min: typeof daily.temperature_2m_min?.[index] === "number" ? daily.temperature_2m_min[index] : null,
        temp_max: max,
        rain_probability: rain,
        wind_max: wind,
        weather_code: code,
        label,
        advice: adviceFor(label, rain, wind, max),
      };
    });

    const tripDays = reliable_for_trip
      ? days.filter((day) => (!query.start || day.date >= query.start.slice(0, 10)) && (!query.end || day.date <= query.end.slice(0, 10)))
      : [];

    return {
      ok: true,
      provider: "Open-Meteo",
      coords,
      generated_at: new Date().toISOString(),
      reliable_for_trip,
      message: reliable_for_trip
        ? "Previsión disponible para las fechas del itinerario."
        : "Las fechas del itinerario están fuera del rango fiable de previsión de 14 días. Se muestra la previsión general próxima, no una predicción exacta del viaje.",
      forecast_days: days,
      trip_days: tripDays,
    };
  });
}

import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";

type DailyOpenMeteoResponse = {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    wind_speed_10m_max?: number[];
  };
};

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizarFecha(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function weatherLabel(code: number | null | undefined): string {
  if (code === null || code === undefined) return "Sin datos";
  if (code === 0) return "Despejado";
  if ([1, 2, 3].includes(code)) return "Parcialmente nuboso";
  if ([45, 48].includes(code)) return "Niebla";
  if ([51, 53, 55, 56, 57].includes(code)) return "Llovizna";
  if ([61, 63, 65, 66, 67].includes(code)) return "Lluvia";
  if ([71, 73, 75, 77].includes(code)) return "Nieve";
  if ([80, 81, 82].includes(code)) return "Chubascos";
  if ([95, 96, 99].includes(code)) return "Tormenta";
  return "Variable";
}

function weatherIcon(code: number | null | undefined): string {
  if (code === null || code === undefined) return "🌤️";
  if (code === 0) return "☀️";
  if ([1, 2, 3].includes(code)) return "⛅";
  if ([45, 48].includes(code)) return "🌫️";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "🌧️";
  if ([71, 73, 75, 77].includes(code)) return "❄️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return "🌤️";
}

function consejoTuristico(code: number | null | undefined, rain: number | null | undefined, tMax: number | null | undefined): string {
  const lluvia = Number(rain ?? 0);
  if ([61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(Number(code)) || lluvia >= 55) {
    return "Conviene priorizar museos, patrimonio cubierto, mercados, gastronomía o planes de interior.";
  }
  if (Number(tMax ?? 0) >= 31) {
    return "Evita las horas centrales del día y prioriza planes de mañana, tarde, sombra o costa.";
  }
  if ([0, 1, 2].includes(Number(code))) {
    return "Buen día para miradores, paseos, rutas urbanas y actividades al aire libre.";
  }
  return "Día razonable para combinar exterior e interior manteniendo cierta flexibilidad.";
}

function climaEstacional(destino: string, month: number) {
  const key = destino.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const norte = key.includes("cantabria") || key.includes("asturias") || key.includes("galicia") || key.includes("pais vasco") || key.includes("bilbao") || key.includes("santander");
  const canarias = key.includes("canarias") || key.includes("tenerife") || key.includes("gran canaria") || key.includes("lanzarote") || key.includes("fuerteventura");
  const mediterraneo = key.includes("valencia") || key.includes("alicante") || key.includes("baleares") || key.includes("mallorca") || key.includes("barcelona") || key.includes("malaga");
  const interior = key.includes("madrid") || key.includes("castilla") || key.includes("zaragoza") || key.includes("toledo") || key.includes("segovia");

  if (canarias) {
    return {
      titulo: "Clima estacional orientativo",
      descripcion: "En Canarias suele haber temperaturas suaves durante gran parte del año. Aun así, en zonas de montaña como el Teide el tiempo puede cambiar mucho y conviene revisar la previsión real antes de salir.",
      rango: "18ºC - 27ºC aprox.",
    };
  }

  if ([12, 1, 2].includes(month)) {
    if (norte) return { titulo: "Clima estacional orientativo", descripcion: "Invierno fresco y húmedo en el norte. Es habitual alternar claros con lluvia, por lo que conviene combinar planes de interior y exterior.", rango: "6ºC - 14ºC aprox." };
    if (mediterraneo) return { titulo: "Clima estacional orientativo", descripcion: "Invierno generalmente suave en la costa mediterránea, con posibilidad de viento o lluvia puntual.", rango: "8ºC - 17ºC aprox." };
    if (interior) return { titulo: "Clima estacional orientativo", descripcion: "Invierno frío en el interior, especialmente por la mañana y noche. Recomendable llevar abrigo y alternar planes cubiertos.", rango: "1ºC - 12ºC aprox." };
    return { titulo: "Clima estacional orientativo", descripcion: "Invierno variable según zona. Revisa previsión real si las fechas se acercan.", rango: "5ºC - 15ºC aprox." };
  }

  if ([3, 4, 5].includes(month)) {
    if (norte) return { titulo: "Clima estacional orientativo", descripcion: "Primavera suave y variable, con posibilidad de lluvia. Buena época para combinar naturaleza, costa y cultura.", rango: "9ºC - 19ºC aprox." };
    if (mediterraneo) return { titulo: "Clima estacional orientativo", descripcion: "Primavera agradable, ideal para paseos, patrimonio y costa sin el calor del verano.", rango: "12ºC - 23ºC aprox." };
    return { titulo: "Clima estacional orientativo", descripcion: "Primavera normalmente cómoda para turismo urbano y rutas, aunque puede haber cambios rápidos de tiempo.", rango: "10ºC - 22ºC aprox." };
  }

  if ([6, 7, 8].includes(month)) {
    if (norte) return { titulo: "Clima estacional orientativo", descripcion: "Verano templado en el norte, bueno para costa, naturaleza y rutas. Puede haber nubes o lluvia puntual.", rango: "16ºC - 25ºC aprox." };
    if (mediterraneo) return { titulo: "Clima estacional orientativo", descripcion: "Verano cálido, ideal para costa, pero conviene evitar horas centrales en rutas urbanas.", rango: "22ºC - 32ºC aprox." };
    if (interior) return { titulo: "Clima estacional orientativo", descripcion: "Verano caluroso en el interior. Mejor planificar visitas por la mañana y al atardecer.", rango: "20ºC - 36ºC aprox." };
    return { titulo: "Clima estacional orientativo", descripcion: "Verano cálido. Prioriza hidratación, sombra y horarios cómodos.", rango: "20ºC - 33ºC aprox." };
  }

  if (norte) return { titulo: "Clima estacional orientativo", descripcion: "Otoño suave y húmedo en el norte. Buena época para gastronomía, naturaleza y planes culturales con margen por lluvia.", rango: "10ºC - 20ºC aprox." };
  if (mediterraneo) return { titulo: "Clima estacional orientativo", descripcion: "Otoño suave, muy aprovechable para ciudad, cultura y costa con menos saturación.", rango: "14ºC - 25ºC aprox." };
  if (interior) return { titulo: "Clima estacional orientativo", descripcion: "Otoño variable en el interior, con mañanas frescas y tardes agradables.", rango: "8ºC - 22ºC aprox." };
  return { titulo: "Clima estacional orientativo", descripcion: "Otoño variable, recomendable revisar previsión al acercarse la fecha.", rango: "10ºC - 23ºC aprox." };
}

export default async function meteorologiaRoutes(app: FastifyInstance) {
  app.get("/itinerario/:id_itinerario", async (request, reply) => {
    const { id_itinerario } = request.params as { id_itinerario: string };
    const itinerarioId = toInt(id_itinerario);

    if (itinerarioId === null) {
      return reply.code(400).send({ message: "id_itinerario inválido" });
    }

    const itinerario = await prisma.itinerario.findUnique({
      where: { id_itinerario: itinerarioId },
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

    if (!itinerario) {
      return reply.code(404).send({ message: "Itinerario no encontrado" });
    }

    const firstPoi = itinerario.dias
      .flatMap((dia) => dia.elementos)
      .map((elemento) => elemento.poi)
      .find((poi) => toNumberOrNull(poi?.latitud) !== null && toNumberOrNull(poi?.longitud) !== null);

    const lat = toNumberOrNull(itinerario.base_latitud) ?? toNumberOrNull(firstPoi?.latitud);
    const lon = toNumberOrNull(itinerario.base_longitud) ?? toNumberOrNull(firstPoi?.longitud);

    if (lat === null || lon === null) {
      return reply.code(422).send({
        message: "No hay coordenadas suficientes para consultar la previsión meteorológica.",
      });
    }

    const destino = itinerario.destino || itinerario.base_nombre || firstPoi?.nombre || "destino";
    const inicio = normalizarFecha(itinerario.inicio);
    const fin = normalizarFecha(itinerario.fin);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxForecast = addDays(today, 13);
    const todayStr = normalizarFecha(today)!;
    const maxForecastStr = normalizarFecha(maxForecast)!;

    const inicioDate = inicio ? new Date(`${inicio}T00:00:00`) : null;
    const finDate = fin ? new Date(`${fin}T00:00:00`) : null;
    const dentroRango = Boolean(
      inicioDate &&
        finDate &&
        !Number.isNaN(inicioDate.getTime()) &&
        !Number.isNaN(finDate.getTime()) &&
        inicioDate <= maxForecast &&
        finDate >= today,
    );

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max");
    url.searchParams.set("timezone", "Europe/Madrid");
    url.searchParams.set("forecast_days", "14");

    const response = await fetch(url.toString());
    if (!response.ok) {
      return reply.code(502).send({ message: "No se pudo consultar la previsión meteorológica." });
    }

    const data = (await response.json()) as DailyOpenMeteoResponse;
    const daily = data.daily ?? {};
    const fechas = daily.time ?? [];

    const proximos14Dias = fechas.map((fecha, index) => {
      const code = daily.weather_code?.[index] ?? null;
      const tMax = daily.temperature_2m_max?.[index] ?? null;
      const tMin = daily.temperature_2m_min?.[index] ?? null;
      const rain = daily.precipitation_probability_max?.[index] ?? null;
      const wind = daily.wind_speed_10m_max?.[index] ?? null;

      return {
        fecha,
        codigo: code,
        icono: weatherIcon(code),
        estado: weatherLabel(code),
        temperatura_max: tMax,
        temperatura_min: tMin,
        probabilidad_lluvia: rain,
        viento_max: wind,
        consejo: consejoTuristico(code, rain, tMax),
        dentro_itinerario:
          dentroRango && inicio !== null && fin !== null ? fecha >= inicio && fecha <= fin : false,
      };
    });

    const diasItinerario = proximos14Dias.filter((dia) => dia.dentro_itinerario);
    const month = inicioDate && !Number.isNaN(inicioDate.getTime()) ? inicioDate.getMonth() + 1 : today.getMonth() + 1;

    return {
      destino,
      latitud: lat,
      longitud: lon,
      inicio_itinerario: inicio,
      fin_itinerario: fin,
      rango_prevision_inicio: todayStr,
      rango_prevision_fin: maxForecastStr,
      prevision_fiable_para_itinerario: dentroRango,
      motivo:
        dentroRango
          ? "Las fechas del itinerario entran dentro de los próximos 14 días, por lo que la previsión puede usarse como apoyo contextual."
          : "Las fechas del itinerario no entran dentro de los próximos 14 días. Por fiabilidad, no se aplica una previsión meteorológica concreta al viaje.",
      dias_itinerario: diasItinerario,
      proximos_14_dias: proximos14Dias,
      clima_estacional: climaEstacional(destino, month),
      fuente: "Open-Meteo Forecast API",
    };
  });
}

export type ContextoMeteorologicoSpainWay = {
  provider: "open-meteo";
  latitude: number;
  longitude: number;
  start_date: string;
  end_date: string;
  summary: string;
  rainy_days: Array<{
    date: string;
    precipitation_probability_max: number | null;
    precipitation_sum: number | null;
    weather_code: number | null;
  }>;
  hot_days: Array<{
    date: string;
    temperature_2m_max: number | null;
  }>;
  days: Array<{
    date: string;
    weather_code: number | null;
    temperature_2m_max: number | null;
    temperature_2m_min: number | null;
    precipitation_probability_max: number | null;
    precipitation_sum: number | null;
  }>;
};

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseYmd(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function asNumberArray(value: unknown): Array<number | null> {
  return Array.isArray(value)
    ? value.map((item) => (Number.isFinite(Number(item)) ? Number(item) : null))
    : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

export async function obtenerContextoMeteorologicoSpainWay(input: {
  lat: number;
  lon: number;
  dates?: string[];
  days?: number;
}): Promise<ContextoMeteorologicoSpainWay | null> {
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lon)) return null;

  const now = new Date();
  const start = parseYmd(input.dates?.[0]) ?? now;
  const requestedDays = Math.max(1, Math.min(Number(input.days ?? 3), 14));
  const end = parseYmd(input.dates?.[1]) ?? addDays(start, requestedDays - 1);

  const params = new URLSearchParams({
    latitude: String(input.lat),
    longitude: String(input.lon),
    timezone: "Europe/Madrid",
    start_date: toYmd(start),
    end_date: toYmd(end),
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
  });

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!response.ok) return null;

    const data = (await response.json()) as {
      daily?: Record<string, unknown>;
    };

    const daily = data.daily ?? {};
    const dates = asStringArray(daily.time);
    const weatherCodes = asNumberArray(daily.weather_code);
    const maxTemps = asNumberArray(daily.temperature_2m_max);
    const minTemps = asNumberArray(daily.temperature_2m_min);
    const rainProb = asNumberArray(daily.precipitation_probability_max);
    const rainSum = asNumberArray(daily.precipitation_sum);

    const days = dates.map((date, index) => ({
      date,
      weather_code: weatherCodes[index] ?? null,
      temperature_2m_max: maxTemps[index] ?? null,
      temperature_2m_min: minTemps[index] ?? null,
      precipitation_probability_max: rainProb[index] ?? null,
      precipitation_sum: rainSum[index] ?? null,
    }));

    const rainyDays = days
      .filter(
        (day) =>
          (day.precipitation_probability_max ?? 0) >= 55 ||
          (day.precipitation_sum ?? 0) >= 2,
      )
      .map((day) => ({
        date: day.date,
        precipitation_probability_max: day.precipitation_probability_max,
        precipitation_sum: day.precipitation_sum,
        weather_code: day.weather_code,
      }));

    const hotDays = days
      .filter((day) => (day.temperature_2m_max ?? 0) >= 30)
      .map((day) => ({
        date: day.date,
        temperature_2m_max: day.temperature_2m_max,
      }));

    const summaryParts: string[] = [];
    if (rainyDays.length > 0) {
      summaryParts.push(
        `Hay ${rainyDays.length} día(s) con probabilidad de lluvia; se recomiendan alternativas de interior.`,
      );
    }
    if (hotDays.length > 0) {
      summaryParts.push(
        `Hay ${hotDays.length} día(s) de calor; conviene evitar caminatas largas en horas centrales.`,
      );
    }
    if (summaryParts.length === 0) {
      summaryParts.push("Previsión sin alertas relevantes para la planificación turística.");
    }

    return {
      provider: "open-meteo",
      latitude: input.lat,
      longitude: input.lon,
      start_date: toYmd(start),
      end_date: toYmd(end),
      summary: summaryParts.join(" "),
      rainy_days: rainyDays,
      hot_days: hotDays,
      days,
    };
  } catch {
    return null;
  }
}

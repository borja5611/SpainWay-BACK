import "dotenv/config";

function requireInProduction(name: string, value: string | undefined): string {
  const normalized = value?.trim() ?? "";

  if (process.env.NODE_ENV === "production" && !normalized) {
    throw new Error(`${name} es obligatorio en producción`);
  }

  return normalized;
}

function optionalString(value: string | undefined, fallback = ""): string {
  return value?.trim() || fallback;
}

function optionalNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === null || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
}

export const env = {
  PORT: optionalNumber(process.env.PORT, 3000),
  NODE_ENV: optionalString(process.env.NODE_ENV, "development"),
  DATABASE_URL: requireInProduction("DATABASE_URL", process.env.DATABASE_URL),
  DIRECT_URL: optionalString(process.env.DIRECT_URL),
  FRONTEND_URL: optionalString(process.env.FRONTEND_URL, "http://localhost:5173"),
  JWT_SECRET: requireInProduction("JWT_SECRET", process.env.JWT_SECRET),
  PASSWORD_RESET_SECRET: requireInProduction("PASSWORD_RESET_SECRET", process.env.PASSWORD_RESET_SECRET),
  PASSWORD_RESET_MINUTES: optionalNumber(process.env.PASSWORD_RESET_MINUTES, 10),
  RECOMMENDER_API_URL: optionalString(process.env.RECOMMENDER_API_URL, "http://localhost:8001"),

  FSQ_API_KEY: optionalString(process.env.FSQ_API_KEY),
  GEOAPIFY_API_KEY: optionalString(process.env.GEOAPIFY_API_KEY),
  TICKETMASTER_API_KEY: optionalString(process.env.TICKETMASTER_API_KEY),
  PREDICTHQ_API_KEY: optionalString(process.env.PREDICTHQ_API_KEY),
  SERPAPI_API_KEY: optionalString(process.env.SERPAPI_API_KEY),
  PREDICTHQ_RADIUS_KM: optionalNumber(process.env.PREDICTHQ_RADIUS_KM, 25),
  EVENTS_LIVE_ENABLED: optionalBoolean(process.env.EVENTS_LIVE_ENABLED, true),
  EVENTS_LIVE_TIMEOUT_MS: optionalNumber(process.env.EVENTS_LIVE_TIMEOUT_MS, 7000),
  EVENTS_LIVE_MAX_RESULTS: optionalNumber(process.env.EVENTS_LIVE_MAX_RESULTS, 20),

  SMTP_HOST: optionalString(process.env.SMTP_HOST),
  SMTP_PORT: optionalNumber(process.env.SMTP_PORT, 587),
  SMTP_SECURE: optionalBoolean(process.env.SMTP_SECURE, false),
  SMTP_USER: optionalString(process.env.SMTP_USER),
  SMTP_PASS: optionalString(process.env.SMTP_PASS),
  SMTP_FROM: optionalString(process.env.SMTP_FROM),
  GOOGLE_CLIENT_ID: optionalString(process.env.GOOGLE_CLIENT_ID),
  GOOGLE_CLIENT_SECRET: optionalString(process.env.GOOGLE_CLIENT_SECRET),
  GOOGLE_REDIRECT_URI: optionalString(process.env.GOOGLE_REDIRECT_URI),
};

import "dotenv/config";

function requireInProduction(name: string, value: string | undefined): string {
  const normalized = value?.trim() ?? "";

  if (process.env.NODE_ENV === "production" && !normalized) {
    throw new Error(`${name} es obligatorio en producción`);
  }

  return normalized;
}

export const env = {
  PORT: Number(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || "development",
  DATABASE_URL: requireInProduction("DATABASE_URL", process.env.DATABASE_URL),
  DIRECT_URL: process.env.DIRECT_URL || "",
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5173",
  JWT_SECRET: requireInProduction("JWT_SECRET", process.env.JWT_SECRET),
  PASSWORD_RESET_SECRET: requireInProduction(
    "PASSWORD_RESET_SECRET",
    process.env.PASSWORD_RESET_SECRET
  ),
  PASSWORD_RESET_MINUTES: Number(process.env.PASSWORD_RESET_MINUTES || 10),
  RECOMMENDER_API_URL: process.env.RECOMMENDER_API_URL || "http://localhost:8001",
  FSQ_API_KEY: process.env.FSQ_API_KEY || "",
  GEOAPIFY_API_KEY: process.env.GEOAPIFY_API_KEY || "",
  TICKETMASTER_API_KEY: process.env.TICKETMASTER_API_KEY || "",
  PREDICTHQ_API_KEY: process.env.PREDICTHQ_API_KEY || "",
  PREDICTHQ_RADIUS_KM: Number(process.env.PREDICTHQ_RADIUS_KM || 25),
  SMTP_HOST: process.env.SMTP_HOST || "",
  SMTP_PORT: Number(process.env.SMTP_PORT || 587),
  SMTP_SECURE: process.env.SMTP_SECURE === "true",
  SMTP_USER: process.env.SMTP_USER || "",
  SMTP_PASS: process.env.SMTP_PASS || "",
  SMTP_FROM: process.env.SMTP_FROM || "",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || "",
};

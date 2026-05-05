import "dotenv/config";

export const env = {
  PORT: Number(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || "development",
  DATABASE_URL: process.env.DATABASE_URL || "",
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5173",
  TICKETMASTER_API_KEY: process.env.TICKETMASTER_API_KEY || "",
  PREDICTHQ_API_KEY: process.env.PREDICTHQ_API_KEY || "",
  PREDICTHQ_RADIUS_KM: Number(process.env.PREDICTHQ_RADIUS_KM || 25),
};
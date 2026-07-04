// Utilidades puras de normalización/saneamiento del payload hacia la IA.
// Sin dependencias de Prisma ni de red: aisladas para poder testearse.

// Normaliza el ritmo a los valores canónicos del motor (relajado | equilibrado | intenso).
export function normalizarRitmo(value: unknown): string {
  const v = String(value ?? "").toLowerCase().trim();
  if (["relaj", "lento", "tranquil", "suave"].some((k) => v.includes(k))) return "relajado";
  if (["intens", "alto", "rapido", "rápido", "activo"].some((k) => v.includes(k))) return "intenso";
  return "equilibrado";
}

// Normaliza el transporte a valores canónicos (coche | a pie | transporte publico | mixto).
export function normalizarTransporte(value: unknown): string {
  const v = String(value ?? "").toLowerCase().trim();
  if (["coche", "car", "conducir", "vehic", "auto"].some((k) => v.includes(k))) return "coche";
  if (["pie", "andando", "caminando", "walk"].some((k) => v.includes(k))) return "a pie";
  if (["publico", "público", "bus", "metro", "tren", "transporte"].some((k) => v.includes(k)))
    return "transporte publico";
  return "mixto";
}

// Semilla de reproducibilidad estable: mismo input => misma semilla.
export function construirRequestSeed(
  destination: string,
  days: number,
  pace: string,
  transport: string,
): string {
  return `${destination}|${days}|${pace}|${transport}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9|\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Saneamiento genérico de listas de strings recibidas del frontend.
export function sanitizarLista(value: unknown, maxItems = 25, maxLen = 120): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim().slice(0, maxLen))
    .filter((item) => item.length > 0)
    .slice(0, maxItems);
}

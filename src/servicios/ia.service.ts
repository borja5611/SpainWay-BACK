// Servicio interno para comunicación con la IA de SpainWay
// Gestiona warm-up compartido, cooldown por 429 y bloqueo anti-doble generación.

const IA_DEFAULT_URL = "https://spainway-ia.onrender.com";
const IA_WARMUP_TTL_MS = 5 * 60 * 1000; // 5 minutos
const IA_COOLDOWN_DEFAULT_MS = 45 * 1000; // 45 segundos

let iaWarmupPromise: Promise<boolean> | null = null;
let lastIaWarmupOkAt = 0;
let iaCooldownUntil = 0;
let generationInProgress = false;

export type IaReadyResult =
  | { ok: true; status: "ready" }
  | { ok: false; status: "warming"; message: string }
  | { ok: false; status: "cooldown"; message: string };

export type IaCallResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: "warming" | "cooldown" | "busy" | "error"; message: string };

function getIaBaseUrl(): string {
  return (process.env.RECOMMENDER_API_URL || IA_DEFAULT_URL).replace(/\/+$/, "");
}

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

async function doWarmup(): Promise<boolean> {
  const baseUrl = getIaBaseUrl();
  console.log("[IA] Warm-up iniciado");

  try {
    let response = await fetchWithTimeout(
      `${baseUrl}/health`,
      { method: "GET", headers: { Accept: "application/json" } },
      15000,
    );

    if (response.status === 404) {
      response = await fetchWithTimeout(
        `${baseUrl}/`,
        { method: "GET", headers: { Accept: "application/json" } },
        10000,
      );
    }

    if (response.ok) {
      lastIaWarmupOkAt = Date.now();
      console.log("[IA] Warm-up correcto");
      return true;
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const cooldownMs = retryAfter ? Number(retryAfter) * 1000 : IA_COOLDOWN_DEFAULT_MS;
      iaCooldownUntil = Date.now() + cooldownMs;
      console.log(`[IA] Cooldown activo por 429 (${cooldownMs / 1000}s)`);
      return false;
    }

    console.log(`[IA] Warm-up fallido (status ${response.status})`);
    return false;
  } catch (error) {
    console.log("[IA] Warm-up fallido:", error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    iaWarmupPromise = null;
  }
}

export async function ensureIaReady(): Promise<IaReadyResult> {
  const now = Date.now();

  if (lastIaWarmupOkAt > 0 && now - lastIaWarmupOkAt < IA_WARMUP_TTL_MS) {
    console.log("[IA] IA caliente, se omite warm-up");
    return { ok: true, status: "ready" };
  }

  if (iaCooldownUntil > now) {
    console.log("[IA] Cooldown activo por 429");
    return {
      ok: false,
      status: "cooldown",
      message: "El motor de recomendaciones se está preparando. Espera unos segundos antes de volver a intentarlo.",
    };
  }

  if (iaWarmupPromise) {
    console.log("[IA] Warm-up reutilizado porque ya hay uno en curso");
    const ok = await iaWarmupPromise;
    if (ok) return { ok: true, status: "ready" };

    if (iaCooldownUntil > Date.now()) {
      return {
        ok: false,
        status: "cooldown",
        message: "El motor de recomendaciones se está preparando. Espera unos segundos antes de volver a intentarlo.",
      };
    }

    return {
      ok: false,
      status: "warming",
      message: "El motor de recomendaciones se está preparando. Espera unos segundos.",
    };
  }

  iaWarmupPromise = doWarmup();
  const ok = await iaWarmupPromise;

  if (ok) return { ok: true, status: "ready" };

  if (iaCooldownUntil > Date.now()) {
    return {
      ok: false,
      status: "cooldown",
      message: "El motor de recomendaciones se está preparando. Espera unos segundos antes de volver a intentarlo.",
    };
  }

  return {
    ok: false,
    status: "warming",
    message: "El motor de recomendaciones se está preparando. Espera unos segundos.",
  };
}

export async function callIaItinerary<T>(payload: unknown): Promise<IaCallResult<T>> {
  if (generationInProgress) {
    console.log("[IA] Generación bloqueada porque ya hay una en curso");
    return {
      ok: false,
      status: "busy",
      message: "Ya se está generando un itinerario. Espera unos segundos.",
    };
  }

  const ready = await ensureIaReady();
  if (!ready.ok) {
    return { ok: false, status: ready.status, message: ready.message };
  }

  generationInProgress = true;
  console.log("[IA] Generación de itinerario iniciada");

  const baseUrl = getIaBaseUrl();
  const endpoint = `${baseUrl}/recommend/itinerary`;

  try {
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      50000,
    );

    if (response.ok) {
      lastIaWarmupOkAt = Date.now();
      console.log("[IA] Generación finalizada correctamente");
      return { ok: true, data: (await response.json()) as T };
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const cooldownMs = retryAfter ? Number(retryAfter) * 1000 : IA_COOLDOWN_DEFAULT_MS;
      iaCooldownUntil = Date.now() + cooldownMs;
      lastIaWarmupOkAt = 0;
      console.log("[IA] IA devolvió 429, no se reintenta en bucle");
      return {
        ok: false,
        status: "cooldown",
        message: "El motor de recomendaciones está ocupado. Espera unos segundos y vuelve a intentarlo.",
      };
    }

    if (response.status === 502 || response.status === 503) {
      lastIaWarmupOkAt = 0;
      console.log(`[IA] IA devolvió ${response.status}, reintento único tras 3s`);

      await new Promise<void>((resolve) => setTimeout(resolve, 3000));

      const retry = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        50000,
      );

      if (retry.ok) {
        lastIaWarmupOkAt = Date.now();
        console.log("[IA] Generación finalizada correctamente (reintento)");
        return { ok: true, data: (await retry.json()) as T };
      }

      if (retry.status === 429) {
        const retryAfter = retry.headers.get("Retry-After");
        const cooldownMs = retryAfter ? Number(retryAfter) * 1000 : IA_COOLDOWN_DEFAULT_MS;
        iaCooldownUntil = Date.now() + cooldownMs;
        console.log("[IA] IA devolvió 429, no se reintenta en bucle");
        return {
          ok: false,
          status: "cooldown",
          message: "El motor de recomendaciones está ocupado. Espera unos segundos y vuelve a intentarlo.",
        };
      }
    }

    return {
      ok: false,
      status: "error",
      message: "El motor de recomendaciones devolvió un error inesperado. Espera unos segundos y vuelve a intentarlo.",
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: "warming",
      message: isTimeout
        ? "El motor de recomendaciones tardó demasiado en responder. Espera unos segundos y vuelve a intentarlo."
        : "No se pudo conectar con el motor de recomendaciones. Espera unos segundos y vuelve a intentarlo.",
    };
  } finally {
    generationInProgress = false;
  }
}

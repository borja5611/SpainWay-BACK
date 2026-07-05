// Servicio interno para comunicación con la IA de SpainWay.
//
// Centraliza tres cosas:
//   1. Un healthcheck CONTROLADO y de timeout corto (nunca bloquea al usuario).
//   2. El estado de "IA caliente" para evitar chequeos repetidos.
//   3. La generación de itinerarios con timeout y contratos de error explícitos
//      (códigos IA_READY / IA_WARMING / IA_TIMEOUT / IA_UNAVAILABLE / IA_BUSY).
//
// Contexto: en el plan free de Render la IA se suspende tras inactividad y su
// arranque en frío puede tardar. El backend NUNCA debe esperar eternamente ni
// propagar un error crudo ("fetch failed") al frontend.

const IA_DEFAULT_URL = "https://spainway-ia.onrender.com";

// Timeouts (configurables por entorno). El healthcheck es corto POR DISEÑO.
const IA_HEALTH_TIMEOUT_MS = Number(process.env.IA_HEALTH_TIMEOUT_MS) || 5000;
const IA_GENERATION_TIMEOUT_MS =
  Number(process.env.IA_GENERATION_TIMEOUT_MS) || 60000;

// Si un health dio "ready" hace poco, evitamos repetir el chequeo antes de generar.
const IA_READY_TTL_MS = 60 * 1000; // 1 minuto
const IA_COOLDOWN_DEFAULT_MS = 45 * 1000; // 45 segundos

export type IaStatus = "ready" | "warming" | "unavailable";
export type IaCode = "IA_READY" | "IA_WARMING" | "IA_TIMEOUT" | "IA_UNAVAILABLE";

export type IaHealth = {
  status: IaStatus;
  iaReady: boolean;
  code: IaCode;
  retryable: boolean;
  message: string;
};

// Resultado de una llamada de generación. `busy` cubre el bloqueo anti-doble
// generación en el propio backend.
export type IaCallResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: "warming" | "unavailable" | "busy";
      code: IaCode | "IA_BUSY";
      message: string;
      retryable: boolean;
    };

const MSG = {
  ready: "Motor de recomendaciones disponible",
  warming: "El motor de recomendaciones se está iniciando en segundo plano.",
  timeout:
    "El motor de recomendaciones no ha respondido a tiempo. Puedes seguir preparando el viaje y reintentarlo.",
  unavailable:
    "El motor de recomendaciones no está disponible ahora mismo. Puedes seguir preparando el viaje y reintentarlo.",
  busy: "Ya se está generando un itinerario. Espera unos segundos.",
} as const;

let lastReadyAt = 0;
let iaCooldownUntil = 0;
let generationInProgress = false;
let inflightHealth: Promise<IaHealth> | null = null;

function getIaBaseUrl(): string {
  return (process.env.RECOMMENDER_API_URL || IA_DEFAULT_URL).replace(/\/+$/, "");
}

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timeout),
  );
}

function isRecentlyReady(): boolean {
  const now = Date.now();
  if (iaCooldownUntil > now) return false;
  return lastReadyAt > 0 && now - lastReadyAt < IA_READY_TTL_MS;
}

// Interpreta el cuerpo de /health de la IA como "listo" en cualquiera de sus
// variantes (nueva y legacy).
function bodyIndicatesReady(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (b.artifacts_ready === true || b.ready === true) return true;
  const status = typeof b.status === "string" ? b.status.toLowerCase() : "";
  return status === "ready" || status === "ok";
}

function bodyIndicatesError(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const status = typeof b.status === "string" ? b.status.toLowerCase() : "";
  return status === "error";
}

function ready(): IaHealth {
  return {
    status: "ready",
    iaReady: true,
    code: "IA_READY",
    retryable: false,
    message: MSG.ready,
  };
}

function warming(): IaHealth {
  return {
    status: "warming",
    iaReady: false,
    code: "IA_WARMING",
    retryable: true,
    message: MSG.warming,
  };
}

function timeoutState(): IaHealth {
  return {
    status: "unavailable",
    iaReady: false,
    code: "IA_TIMEOUT",
    retryable: true,
    message: MSG.timeout,
  };
}

function unavailableState(): IaHealth {
  return {
    status: "unavailable",
    iaReady: false,
    code: "IA_UNAVAILABLE",
    retryable: true,
    message: MSG.unavailable,
  };
}

/**
 * Consulta el estado de la IA de forma CONTROLADA y con timeout corto.
 * Nunca lanza: siempre resuelve a un IaHealth normalizado.
 *
 *   - IA responde ready            -> status "ready"
 *   - IA dormida/arrancando/503/429 -> status "warming"  (retryable)
 *   - IA no responde a tiempo       -> status "unavailable" code IA_TIMEOUT
 *   - Error de red / caída          -> status "unavailable" code IA_UNAVAILABLE
 */
export async function checkIaHealth(): Promise<IaHealth> {
  // Reutiliza un chequeo en curso para no saturar la IA con peticiones paralelas.
  if (inflightHealth) return inflightHealth;

  inflightHealth = (async (): Promise<IaHealth> => {
    const baseUrl = getIaBaseUrl();
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/health`,
        { method: "GET", headers: { Accept: "application/json" } },
        IA_HEALTH_TIMEOUT_MS,
      );

      if (response.ok) {
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }

        if (bodyIndicatesReady(body)) {
          lastReadyAt = Date.now();
          return ready();
        }
        if (bodyIndicatesError(body)) {
          // Fallo real de carga de artefactos: retryable pero no "ready".
          return unavailableState();
        }
        return warming();
      }

      // Respuestas no-2xx: la IA está dormida o arrancando en Render.
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const cooldownMs = retryAfter
          ? Number(retryAfter) * 1000
          : IA_COOLDOWN_DEFAULT_MS;
        iaCooldownUntil = Date.now() + cooldownMs;
      }
      console.log(`[IA] Healthcheck no-ok (status ${response.status}) -> warming`);
      return warming();
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === "AbortError";
      console.log(
        `[IA] Healthcheck fallido (${isTimeout ? "timeout" : "red"}):`,
        error instanceof Error ? error.message : String(error),
      );
      return isTimeout ? timeoutState() : unavailableState();
    } finally {
      inflightHealth = null;
    }
  })();

  return inflightHealth;
}

/**
 * Compatibilidad: versión previa usada por la ruta health. Delega en
 * checkIaHealth y respeta el TTL de "IA caliente".
 */
export async function ensureIaReady(): Promise<IaHealth> {
  if (isRecentlyReady()) {
    return ready();
  }
  return checkIaHealth();
}

// Extrae un código de error controlado del cuerpo de una respuesta no-ok de la IA.
async function leerCodigoErrorIa(response: Response): Promise<string | null> {
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return typeof body?.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

/**
 * Genera un itinerario llamando a la IA. Antes de lanzar la generación hace un
 * pre-check rápido de salud (salvo que la IA esté caliente) para no quedarse
 * esperando 60-120 s a un arranque en frío. Devuelve un contrato de error
 * explícito que el frontend puede distinguir.
 */
export async function callIaItinerary<T>(
  payload: unknown,
): Promise<IaCallResult<T>> {
  if (generationInProgress) {
    console.log("[IA] Generación bloqueada porque ya hay una en curso");
    return {
      ok: false,
      status: "busy",
      code: "IA_BUSY",
      message: MSG.busy,
      retryable: true,
    };
  }

  // Pre-check rápido: si la IA no está lista, cortamos aquí con un código claro.
  if (!isRecentlyReady()) {
    const health = await checkIaHealth();
    if (health.status !== "ready") {
      return {
        ok: false,
        status: health.status === "warming" ? "warming" : "unavailable",
        code: health.code,
        message: health.message,
        retryable: health.retryable,
      };
    }
  }

  generationInProgress = true;
  console.log("[IA] Generación de itinerario iniciada");

  const baseUrl = getIaBaseUrl();
  const endpoint = `${baseUrl}/recommend/itinerary`;
  const requestInit: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };

  try {
    let response = await fetchWithTimeout(
      endpoint,
      requestInit,
      IA_GENERATION_TIMEOUT_MS,
    );

    // Reintento único ante un 502/503 puntual (reinicio en caliente de Render).
    if (response.status === 502 || response.status === 503) {
      const codigo = await leerCodigoErrorIa(response);
      // Si la IA dice explícitamente que está calentando, no insistimos: se
      // relaya el estado para que el frontend reintente con backoff.
      if (codigo === "IA_WARMING" || codigo === "IA_UNAVAILABLE") {
        lastReadyAt = 0;
        return {
          ok: false,
          status: codigo === "IA_WARMING" ? "warming" : "unavailable",
          code: codigo,
          message:
            codigo === "IA_WARMING" ? MSG.warming : MSG.unavailable,
          retryable: true,
        };
      }

      lastReadyAt = 0;
      console.log(`[IA] IA devolvió ${response.status}, reintento único tras 3s`);
      await new Promise<void>((resolve) => setTimeout(resolve, 3000));
      response = await fetchWithTimeout(
        endpoint,
        requestInit,
        IA_GENERATION_TIMEOUT_MS,
      );
    }

    if (response.ok) {
      lastReadyAt = Date.now();
      console.log("[IA] Generación finalizada correctamente");
      return { ok: true, data: (await response.json()) as T };
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const cooldownMs = retryAfter
        ? Number(retryAfter) * 1000
        : IA_COOLDOWN_DEFAULT_MS;
      iaCooldownUntil = Date.now() + cooldownMs;
      lastReadyAt = 0;
      console.log("[IA] IA devolvió 429, no se reintenta en bucle");
      return {
        ok: false,
        status: "warming",
        code: "IA_WARMING",
        message: MSG.warming,
        retryable: true,
      };
    }

    lastReadyAt = 0;
    return {
      ok: false,
      status: "unavailable",
      code: "IA_UNAVAILABLE",
      message: MSG.unavailable,
      retryable: true,
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    lastReadyAt = 0;
    return {
      ok: false,
      status: "unavailable",
      code: isTimeout ? "IA_TIMEOUT" : "IA_UNAVAILABLE",
      message: isTimeout ? MSG.timeout : MSG.unavailable,
      retryable: true,
    };
  } finally {
    generationInProgress = false;
  }
}

// --- Utilidades de test -----------------------------------------------------
// Permite reiniciar el estado interno entre tests para que sean deterministas.
export function resetIaServiceStateForTests(): void {
  lastReadyAt = 0;
  iaCooldownUntil = 0;
  generationInProgress = false;
  inflightHealth = null;
}

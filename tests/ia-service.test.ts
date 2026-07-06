import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  checkIaHealth,
  callIaItinerary,
  resetIaServiceStateForTests,
} from "../src/servicios/ia.service";

const realFetch = globalThis.fetch;

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

function stubFetch(handler: FetchHandler) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

beforeEach(() => {
  resetIaServiceStateForTests();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("checkIaHealth: IA lista -> status ready / iaReady true", async () => {
  stubFetch(async () =>
    jsonResponse({ status: "ready", artifacts_ready: true, pois_loaded: 66473 }),
  );

  const health = await checkIaHealth();
  assert.equal(health.status, "ready");
  assert.equal(health.iaReady, true);
  assert.equal(health.code, "IA_READY");
});

test("checkIaHealth: IA arrancando (200 warming) -> status warming / retryable", async () => {
  stubFetch(async () => jsonResponse({ status: "warming", artifacts_ready: false }));

  const health = await checkIaHealth();
  assert.equal(health.status, "warming");
  assert.equal(health.iaReady, false);
  assert.equal(health.code, "IA_WARMING");
  assert.equal(health.retryable, true);
});

test("checkIaHealth: IA dormida (503) -> se normaliza a warming, no propaga 503", async () => {
  stubFetch(async () => jsonResponse({ message: "Service Unavailable" }, 503));

  const health = await checkIaHealth();
  assert.equal(health.status, "warming");
  assert.equal(health.iaReady, false);
});

test("checkIaHealth: timeout -> status unavailable code IA_TIMEOUT", async () => {
  stubFetch(async () => {
    throw abortError();
  });

  const health = await checkIaHealth();
  assert.equal(health.status, "unavailable");
  assert.equal(health.code, "IA_TIMEOUT");
  assert.equal(health.retryable, true);
});

test("checkIaHealth: error de red -> unavailable code IA_UNAVAILABLE", async () => {
  stubFetch(async () => {
    throw new TypeError("fetch failed");
  });

  const health = await checkIaHealth();
  assert.equal(health.status, "unavailable");
  assert.equal(health.code, "IA_UNAVAILABLE");
});

test("callIaItinerary: si la IA está warming devuelve error controlado IA_WARMING (no espera a generar)", async () => {
  stubFetch(async (url) => {
    assert.ok(url.includes("/health"), "solo debe consultar /health en el pre-check");
    return jsonResponse({ status: "warming", artifacts_ready: false });
  });

  const result = await callIaItinerary({ destino: "Madrid" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "IA_WARMING");
    assert.equal(result.status, "warming");
    assert.equal(result.retryable, true);
  }
});

test("callIaItinerary: IA lista -> genera y devuelve datos", async () => {
  stubFetch(async (url) => {
    if (url.includes("/health")) {
      return jsonResponse({ status: "ready", artifacts_ready: true });
    }
    if (url.includes("/recommend/itinerary")) {
      return jsonResponse({ destination: "Madrid", day_plans: [] });
    }
    throw new Error(`URL inesperada: ${url}`);
  });

  const result = await callIaItinerary<{ destination: string }>({ destino: "Madrid" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.destination, "Madrid");
  }
});

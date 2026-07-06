import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import healthRoutes from "../src/modules/health/health.routes";
import { resetIaServiceStateForTests } from "../src/servicios/ia.service";

const realFetch = globalThis.fetch;

function stubFetch(handler: () => Promise<Response>) {
  globalThis.fetch = (() => handler()) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function buildTestApp() {
  const app = Fastify();
  await app.register(healthRoutes, { prefix: "/api/health" });
  await app.ready();
  return app;
}

beforeEach(() => {
  resetIaServiceStateForTests();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("wake-ia: 200 con iaReady:true cuando la IA está lista", async () => {
  stubFetch(async () => jsonResponse({ status: "ready", artifacts_ready: true }));
  const app = await buildTestApp();

  const res = await app.inject({ method: "GET", url: "/api/health/wake-ia" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.status, "ready");
  assert.equal(body.data.iaReady, true);
  assert.ok(body.data.checkedAt);

  await app.close();
});

test("wake-ia: 200 (NO 503) con iaReady:false cuando la IA devuelve 503", async () => {
  stubFetch(async () => jsonResponse({ message: "Service Unavailable" }, 503));
  const app = await buildTestApp();

  const res = await app.inject({ method: "GET", url: "/api/health/wake-ia" });
  // La clave del fix: el frontend nunca recibe un 503 fatal desde wake-ia.
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.iaReady, false);
  assert.equal(body.data.status, "warming");
  assert.equal(body.data.retryable, true);

  await app.close();
});

test("wake-ia: 200 con iaReady:false y code IA_TIMEOUT cuando la IA no responde", async () => {
  stubFetch(async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  });
  const app = await buildTestApp();

  const res = await app.inject({ method: "GET", url: "/api/health/wake-ia" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.iaReady, false);
  assert.equal(body.data.code, "IA_TIMEOUT");

  await app.close();
});

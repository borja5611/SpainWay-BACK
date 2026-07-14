import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import {
  validarUsuarioDeRuta,
  validarPropiedadRecurso,
  toInt,
  esAdministrador,
} from "../src/hooks/auth.hook";

// ---------------------------------------------------------------------------
// Tests de seguridad del control de acceso (auth.hook + rutas protegidas).
// Los tests de integración usan app.inject: los preHandler rechazan (401/403)
// ANTES de tocar la base de datos, por lo que no requieren conexión a Postgres.
// ---------------------------------------------------------------------------

let appPromise: Promise<FastifyInstance> | null = null;
function getApp(): Promise<FastifyInstance> {
  if (!appPromise) appPromise = buildApp();
  return appPromise;
}
after(async () => {
  if (appPromise) {
    const app = await appPromise;
    await app.close();
  }
});

function fakeReply() {
  const r: {
    statusCode: number;
    body: unknown;
    code: (c: number) => typeof r;
    send: (b: unknown) => typeof r;
  } = {
    statusCode: 0,
    body: null,
    code(c: number) {
      r.statusCode = c;
      return r;
    },
    send(b: unknown) {
      r.body = b;
      return r;
    },
  };
  return r;
}

// ---- Unidad: validarUsuarioDeRuta ----
test("validarUsuarioDeRuta: el mismo usuario es válido", () => {
  assert.equal(validarUsuarioDeRuta("7", 7), true);
  assert.equal(validarUsuarioDeRuta(7, 7), true);
});

test("validarUsuarioDeRuta: otro usuario NO es válido (anti-IDOR)", () => {
  assert.equal(validarUsuarioDeRuta("8", 7), false);
  assert.equal(validarUsuarioDeRuta("abc", 7), false);
  assert.equal(validarUsuarioDeRuta(null, 7), false);
});

test("toInt convierte enteros y rechaza no-enteros", () => {
  assert.equal(toInt("5"), 5);
  assert.equal(toInt("5.4"), null);
  assert.equal(toInt("x"), null);
});

// ---- Unidad: validarPropiedadRecurso (preHandler factory) ----
test("validarPropiedadRecurso: el dueño continúa (sin respuesta)", async () => {
  const hook = validarPropiedadRecurso("id");
  const reply = fakeReply();
  await hook(
    { user: { id_usuario: 7 }, params: { id: "7" } } as never,
    reply as never
  );
  assert.equal(reply.statusCode, 0, "el dueño no debe recibir respuesta de error");
});

test("validarPropiedadRecurso: un tercero recibe 403", async () => {
  const hook = validarPropiedadRecurso("id");
  const reply = fakeReply();
  await hook(
    { user: { id_usuario: 7 }, params: { id: "8" } } as never,
    reply as never
  );
  assert.equal(reply.statusCode, 403);
});

test("validarPropiedadRecurso: un administrador puede acceder a recursos ajenos", async () => {
  const hook = validarPropiedadRecurso("id");
  const reply = fakeReply();
  await hook(
    { user: { id_usuario: 7, rol: "admin" }, params: { id: "8" } } as never,
    reply as never
  );
  assert.equal(reply.statusCode, 0);
});

test("esAdministrador distingue el rol", () => {
  assert.equal(esAdministrador({ user: { rol: "admin" } } as never), true);
  assert.equal(esAdministrador({ user: { rol: "user" } } as never), false);
  assert.equal(esAdministrador({ user: {} } as never), false);
});

// ---- Integración: rutas protegidas (rechazo antes de BD) ----
test("GET /api/usuarios/:id sin token -> 401", async () => {
  const app = await getApp();
  const res = await app.inject({ method: "GET", url: "/api/usuarios/1" });
  assert.equal(res.statusCode, 401);
});

test("GET /api/usuarios/:id con token de OTRO usuario -> 403 (IDOR bloqueado)", async () => {
  const app = await getApp();
  const token = app.jwt.sign({ id_usuario: 1, email: "a@a.com", rol: "user", nombre_usuario: "a" });
  const res = await app.inject({
    method: "GET",
    url: "/api/usuarios/2",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 403);
});

test("DELETE /api/usuarios/:id sin token -> 401 (no se pueden borrar cuentas sin auth)", async () => {
  const app = await getApp();
  const res = await app.inject({ method: "DELETE", url: "/api/usuarios/1" });
  assert.equal(res.statusCode, 401);
});

test("GET /api/interacciones/:id sin token -> 401 (fuga de itinerarios cerrada)", async () => {
  const app = await getApp();
  const res = await app.inject({ method: "GET", url: "/api/interacciones/5" });
  assert.equal(res.statusCode, 401);
});

test("POST /api/recomendador/generar sin token -> 401", async () => {
  const app = await getApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/recomendador/generar",
    payload: { destination: "Valencia", days: 2 },
  });
  assert.equal(res.statusCode, 401);
});

test("GET /api/conversaciones/:id_usuario con token ajeno -> 403", async () => {
  const app = await getApp();
  const token = app.jwt.sign({ id_usuario: 1, email: "a@a.com", rol: "user", nombre_usuario: "a" });
  const res = await app.inject({
    method: "GET",
    url: "/api/conversaciones/2",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 403);
});

test("GET /api/restauracion/selecciones/:id_itinerario sin token -> 401", async () => {
  const app = await getApp();
  const res = await app.inject({ method: "GET", url: "/api/restauracion/selecciones/3" });
  assert.equal(res.statusCode, 401);
});

test("Una ruta pública de catálogo NO exige token (no rompemos lo público)", async () => {
  const app = await getApp();
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.ok(res.statusCode !== 401 && res.statusCode !== 403, `health no debe requerir auth, fue ${res.statusCode}`);
});

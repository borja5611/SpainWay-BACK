import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarRitmo,
  normalizarTransporte,
  construirRequestSeed,
  sanitizarLista,
} from "../src/modules/recomendador/recomendador-normalizacion";

test("normalizarRitmo mapea sinónimos a valores canónicos", () => {
  assert.equal(normalizarRitmo("relajado"), "relajado");
  assert.equal(normalizarRitmo("Tranquilo"), "relajado");
  assert.equal(normalizarRitmo("intenso"), "intenso");
  assert.equal(normalizarRitmo("rápido"), "intenso");
  assert.equal(normalizarRitmo("medio"), "equilibrado");
  assert.equal(normalizarRitmo(undefined), "equilibrado");
});

test("normalizarTransporte mapea sinónimos a valores canónicos", () => {
  assert.equal(normalizarTransporte("coche"), "coche");
  assert.equal(normalizarTransporte("Conducir"), "coche");
  assert.equal(normalizarTransporte("a pie"), "a pie");
  assert.equal(normalizarTransporte("caminando"), "a pie");
  assert.equal(normalizarTransporte("bus"), "transporte publico");
  assert.equal(normalizarTransporte(""), "mixto");
});

test("construirRequestSeed es determinista y sin acentos", () => {
  const a = construirRequestSeed("Cataluña", 3, "equilibrado", "coche");
  const b = construirRequestSeed("Cataluña", 3, "equilibrado", "coche");
  assert.equal(a, b);
  assert.equal(a, "cataluna|3|equilibrado|coche");
});

test("sanitizarLista limpia, recorta y limita", () => {
  assert.deepEqual(sanitizarLista(["  playa ", "", "cultura"]), ["playa", "cultura"]);
  assert.deepEqual(sanitizarLista("no-es-array"), []);
  assert.equal(sanitizarLista(Array.from({ length: 50 }, (_, i) => `t${i}`), 10).length, 10);
});

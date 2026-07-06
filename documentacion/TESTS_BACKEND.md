# Pruebas del backend

## Infraestructura

Se usa el **runner de pruebas integrado de Node** (`node:test`) ejecutado con
`tsx`, sin añadir dependencias nuevas (no se instaló Jest/Vitest).

`package.json`:

```json
{
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "tsx --test tests/**/*.test.ts"
  }
}
```

- `build` compila todo `src` (rootDir `./src`); los tests viven fuera de `src`
  (`tests/`) y no entran en la compilación de producción.
- `typecheck` valida tipos sin emitir.

## Cobertura actual

`tests/recomendador-normalizacion.test.ts` (4 tests) cubre las utilidades puras
que normalizan y sanean el payload hacia la IA
(`src/modules/recomendador/recomendador-normalizacion.ts`):

| Test | Qué garantiza |
|------|---------------|
| `normalizarRitmo` | Sinónimos → `relajado` / `equilibrado` / `intenso`. |
| `normalizarTransporte` | Sinónimos → `coche` / `a pie` / `transporte publico` / `mixto`. |
| `construirRequestSeed` | Semilla determinista y sin acentos (reproducibilidad). |
| `sanitizarLista` | Limpia, recorta y limita listas de entrada. |

Estas funciones se extrajeron a un módulo sin dependencias de Prisma/red
precisamente para poder testearse de forma aislada y rápida.

## Comandos

```bash
npm install
npx prisma validate      # esquema válido
npx prisma generate      # cliente Prisma
npm run typecheck        # tsc --noEmit
npm run build            # tsc  (exit 0)
npm test                 # 4 tests OK
```

> No se ejecuta ninguna operación destructiva contra la base de datos: los tests
> son unitarios sobre lógica pura. No se usan `prisma migrate`/`db push`.

## Ampliaciones recomendadas (futuro)

- Test de contrato del payload IA (forma de `PayloadRecomendador`).
- Smoke de rutas principales con `app.inject` (Fastify) sin tocar BD real.
- Test del endpoint de auditoría con un `ia_json` simulado.

## Evidencia para la memoria

- Salida de `npm test` (4 passing) y de `npm run build` (exit 0) — Anexo H.
- Salida de `npx prisma validate` / `generate`.

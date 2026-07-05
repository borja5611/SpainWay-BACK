# Warm-up de la IA y timeouts

## Problema: cold start en Render (plan free)

El servicio de IA (`SpainWay-IA`) se despliega en Render en plan **free**, que
**suspende** el contenedor tras un periodo de inactividad. Al despertar, el
proceso vuelve a arrancar y a cargar el dataset de POIs, lo que puede tardar
varios segundos.

Síntoma original en producción: al entrar en "Crear itinerario" la app llamaba a
`/api/health/wake-ia`, recibía un **503** y lo trataba como error fatal. La
pantalla podía quedarse bloqueada 10–15 min mostrando "El motor de
recomendaciones se está preparando…".

## Solución: `wake-ia` como endpoint de ESTADO

`GET /api/health/wake-ia` **ya no falla**. Es un endpoint de estado que responde
**siempre 200** con un envelope controlado (salvo un fallo crítico realmente
inesperado, que también se normaliza a 200). El frontend nunca vuelve a recibir
un 503 fatal desde este endpoint.

### Contrato

**IA lista:**

```json
{
  "ok": true,
  "data": {
    "status": "ready",
    "iaReady": true,
    "retryable": false,
    "code": "IA_READY",
    "message": "Motor de recomendaciones disponible",
    "checkedAt": "2026-07-05T10:00:00.000Z"
  }
}
```

**IA dormida / despertando / la IA devolvió 503 o 429:**

```json
{
  "ok": true,
  "data": {
    "status": "warming",
    "iaReady": false,
    "retryable": true,
    "code": "IA_WARMING",
    "message": "El motor de recomendaciones se está iniciando en segundo plano.",
    "checkedAt": "..."
  }
}
```

**La IA no responde a tiempo (timeout):**

```json
{
  "ok": true,
  "data": {
    "status": "unavailable",
    "iaReady": false,
    "retryable": true,
    "code": "IA_TIMEOUT",
    "message": "El motor de recomendaciones no ha respondido a tiempo. Puedes seguir preparando el viaje y reintentarlo.",
    "checkedAt": "..."
  }
}
```

## Estados y códigos internos

| `status` | `code` | Significado |
|----------|--------|-------------|
| `ready` | `IA_READY` | La IA respondió `/health` como lista. |
| `warming` | `IA_WARMING` | Dormida o arrancando (incluye 503/429 de la IA). Retryable. |
| `unavailable` | `IA_TIMEOUT` | La IA no respondió dentro del timeout. Retryable. |
| `unavailable` | `IA_UNAVAILABLE` | Error de red o fallo real de carga de artefactos. Retryable. |

## Timeouts

Configurables por variables de entorno (con valores por defecto seguros):

| Variable | Defecto | Uso |
|----------|---------|-----|
| `IA_HEALTH_TIMEOUT_MS` | `5000` | Timeout del healthcheck / wake-ia. **Corto por diseño.** |
| `IA_GENERATION_TIMEOUT_MS` | `60000` | Timeout de la llamada `POST /recommend/itinerary`. |
| `RECOMMENDER_API_URL` | `https://spainway-ia.onrender.com` | Base URL de la IA. |

Reglas:

- El healthcheck **nunca** espera más de 5 s.
- La generación hace un **pre-check rápido** de salud antes de lanzar la
  generación: si la IA está warming/unavailable, corta con un error controlado en
  lugar de esperar 60–120 s a un arranque en frío.
- Errores de Axios/fetch **normalizados**: nunca se propaga un "fetch failed"
  crudo ni un stacktrace al frontend.

## Contrato de error de generación

`POST /api/recomendador/generar`, cuando la IA no está lista, responde con un
cuerpo explícito que el frontend distingue:

```json
{
  "ok": false,
  "code": "IA_WARMING",
  "status": "warming",
  "message": "El motor de recomendaciones se está iniciando. Inténtalo de nuevo en unos segundos.",
  "retryable": true
}
```

- `409` si hay una generación en curso (`code: IA_BUSY`).
- `503` si la IA está warming/timeout/unavailable (`code: IA_WARMING` /
  `IA_TIMEOUT` / `IA_UNAVAILABLE`).

## Implementación

- `src/servicios/ia.service.ts`:
  - `checkIaHealth()` — healthcheck controlado, timeout corto, nunca lanza.
  - `callIaItinerary()` — pre-check + generación con timeout y códigos de error.
- `src/modules/health/health.routes.ts` — `wake-ia` con envelope 200.
- `src/modules/recomendador/recomendador.routes.ts` — relaya `code`/`retryable`.

## Limitación del plan free

En Render free el primer acceso tras la suspensión sufre el cold start. Con esta
arquitectura el usuario **no se bloquea**: rellena el viaje mientras la IA
despierta, y el frontend reintenta con backoff hasta que `status` pasa a `ready`.
La solución definitiva a la latencia de arranque sería un plan de pago sin
suspensión o un cron de keep-alive; el warm-up controlado es la mitigación a
coste cero.

## Tests

- `tests/ia-service.test.ts` — `checkIaHealth` (ready/warming/timeout/red) y
  `callIaItinerary` (warming vs. ready).
- `tests/health-wake-ia.test.ts` — `wake-ia` devuelve **200** con `iaReady`
  correcto incluso cuando la IA devuelve 503 o no responde.

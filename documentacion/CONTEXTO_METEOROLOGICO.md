# Contexto meteorológico

El backend enriquece la petición a la IA con la **previsión meteorológica** del
destino, de forma que el recomendador pueda adaptar la selección (penalizar
exteriores con lluvia, priorizar interiores con calor, etc.).

## Servicio

`src/modules/meteorologia/meteorologia.service.ts` →
`obtenerContextoMeteorologicoSpainWay({ lat, lon, dates?, days? })`.

- Proveedor: **Open-Meteo** (gratuito, sin clave). Endpoint
  `https://api.open-meteo.com/v1/forecast`.
- Ventana: `dates[0]`..`dates[1]` o `start`..`start + (days-1)` (máx. 14 días).
- Variables diarias: `weather_code`, `temperature_2m_max/min`,
  `precipitation_probability_max`, `precipitation_sum`.
- Devuelve `null` de forma segura si faltan coordenadas o falla la red.

## Forma del contexto (`ContextoMeteorologicoSpainWay`)

```ts
{
  provider: "open-meteo",
  latitude, longitude, start_date, end_date,
  summary: string,                       // resumen textual
  rainy_days: [{ date, precipitation_probability_max, precipitation_sum, weather_code }],
  hot_days:   [{ date, temperature_2m_max }],
  days:       [{ date, weather_code, temperature_2m_max, temperature_2m_min,
                 precipitation_probability_max, precipitation_sum }]
}
```

## Integración en la generación

En `recomendador.routes.ts` se llama mediante `obtenerContextoMeteoSafe(...)`
(envuelto en `try/catch`) y se adjunta al payload como `weather_context`. **Nunca
bloquea la generación**: si Open-Meteo falla, el viaje se genera igualmente sin
contexto climático.

```ts
const contextoMeteo = await obtenerContextoMeteoSafe({
  lat: baseLat, lon: baseLon,
  dates: Array.isArray(body.dates) ? body.dates : undefined,
  days,
});
// ...
weather_context: contextoMeteo ?? undefined,
```

## Cómo lo consume la IA

El motor lee `weather_context.days[]` y detecta un `weather_mode`:

- `adverse` si ≥ la mitad de los días tienen `precipitation_probability_max ≥ 55`.
- `hot` si `max(temperature_2m_max) ≥ 33`.
- `ok` en otro caso; `none` si no hay datos.

Ese modo alimenta el criterio `score_weather_context` (penaliza exteriores con
lluvia, matiza con calor) y la métrica `weather_feasibility` del `route_metrics`.

> Nota: existe además el endpoint de solo lectura `GET /meteorologia/contexto`
> del propio microservicio IA, con una forma de datos (`dias[]` con `lluvia`,
> `tempMax`) que el detector también reconoce.

## Evidencia para la memoria

- Payload enviado a la IA con `weather_context` poblado (Anexo E/F).
- Un itinerario cuyo `route_metrics.weather_feasibility` refleje el clima.

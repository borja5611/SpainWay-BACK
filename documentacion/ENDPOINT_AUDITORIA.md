# Endpoint de auditoría de la recomendación

## 1. Descripción

Endpoint que expone, de forma segura, la **traza de decisión** con la que la IA
construyó un itinerario. Permite justificar *por qué* se recomendó lo que se recomendó:
resumen de entrada, pipeline de candidatos, pesos de *scoring*, resumen de selección,
banderas y métricas de calidad.

- **Fichero:** `src/modules/itinerarios/itinerarios.routes.ts`
- **Ruta:** `GET /api/itinerarios/:idItinerario/auditoria`
- **Autenticación:** obligatoria (JWT Bearer)
- **Autorización:** solo el **propietario** del itinerario

## 2. Autenticación y autorización

```ts
// getUsuarioIdAutenticado(request):
await request.jwtVerify();              // valida el token
const user = request.user as JwtUsuario;
const usuarioId = toInt(user.id_usuario);   // extrae id_usuario del token
```

La propiedad se comprueba en la propia consulta a base de datos (no basta con estar
autenticado, hay que ser dueño):

```ts
const itinerario = await prisma.itinerario.findFirst({
  where: { id_itinerario: idItin, id_usuario: usuarioId },   // ← ownership
  select: { id_itinerario: true, titulo: true, destino: true, ia_json: true },
});
```

## 3. Códigos de respuesta

| Código | Situación |
|--------|-----------|
| `200` | OK (con `available: true` o `available: false`) |
| `401` | Token ausente o inválido (`{ ok:false, message:"No autenticado" }`) |
| `400` | `idItinerario` no numérico |
| `404` | El itinerario no existe **o no pertenece** al usuario |

## 4. Lógica de disponibilidad

Se lee `ia_json` y se comprueba si contiene metadatos de motor o traza:

```ts
const ia = itinerario.ia_json ?? null;
const engine = ia?.engine_metadata ?? null;
const trace  = ia?.decision_trace ?? null;
const available = Boolean(engine || trace);
```

- Si `available === false` → itinerario **legado** (generado con una versión anterior).
- Si `available === true` → se proyecta la traza a una forma estable de respuesta.

## 5. Forma de la respuesta (caso disponible)

```jsonc
{
  "ok": true,
  "available": true,
  "id_itinerario": 128,
  "engine": {                       // ia_json.engine_metadata
    "engine_version": "…", "model": "…", "generation_ms": 1234
  },
  "input_summary": {                // decision_trace.input_summary
    "destination": "Valencia", "days": 3, "pace": "equilibrado"
  },
  "candidate_pipeline": [           // decision_trace.candidate_pipeline (por defecto [])
    { "stage": "retrieval", "in": 500, "out": 120 },
    { "stage": "scoring",   "in": 120, "out": 30 },
    { "stage": "selection", "in": 30,  "out": 9 }
  ],
  "scoring_weights": {              // decision_trace.scoring_weights
    "distance": 0.3, "popularity": 0.2, "interest_match": 0.5
  },
  "selected_summary": {             // decision_trace.selected_summary
    "total_pois": 9, "days": 3
  },
  "quality_flags": ["ok"],          // decision_trace.quality_flags (por defecto [])
  "quality_metrics": {              // ia_json.quality_metrics
    "coverage": 0.92, "diversity": 0.7
  },
  "summary_message": "Resumen de criterios utilizados para construir la recomendación."
}
```

### Mapeo de campos (origen en `ia_json`)

| Campo respuesta | Origen | Valor por defecto |
|-----------------|--------|-------------------|
| `engine` | `ia_json.engine_metadata` | `null` |
| `input_summary` | `decision_trace.input_summary` | `null` |
| `candidate_pipeline` | `decision_trace.candidate_pipeline` | `[]` |
| `scoring_weights` | `decision_trace.scoring_weights` | `null` |
| `selected_summary` | `decision_trace.selected_summary` | `null` |
| `quality_flags` | `decision_trace.quality_flags` | `[]` |
| `quality_metrics` | `ia_json.quality_metrics` | `null` |
| `summary_message` | constante | fija |

## 6. Forma de la respuesta (caso legado, `available:false`)

```jsonc
{
  "ok": true,
  "available": false,
  "id_itinerario": 57,
  "summary_message": "Resumen de criterios utilizados para construir la recomendación.",
  "message": "Este itinerario se generó con una versión anterior y no incluye traza de auditoría."
}
```

## 7. Diseño de la respuesta (sin literatura académica)

El endpoint devuelve **datos estructurados y crudos** de la traza, no textos
explicativos generados. La única cadena fija es `summary_message`
(`"Resumen de criterios utilizados para construir la recomendación."`). Esto mantiene el
endpoint como una **fuente de verdad técnica** reutilizable por el frontend o por la
memoria del TFG, sin acoplarlo a redacción concreta.

## 8. Ejemplo de invocación (curl)

```bash
curl -H "Authorization: Bearer $TOKEN" \
     https://<backend-render>/api/itinerarios/128/auditoria
```

Errores típicos:

```bash
# Sin token → 401
curl https://<backend-render>/api/itinerarios/128/auditoria
# {"ok":false,"message":"No autenticado"}

# Itinerario de otro usuario → 404
curl -H "Authorization: Bearer $TOKEN_OTRO" \
     https://<backend-render>/api/itinerarios/128/auditoria
# {"ok":false,"message":"Itinerario no encontrado o no te pertenece"}
```

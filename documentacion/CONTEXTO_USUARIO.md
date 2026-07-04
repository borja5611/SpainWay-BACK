# Contexto de usuario hacia la IA

## 1. Objetivo

Enriquecer la petición a la IA con el **perfil real del usuario** (preferencias
guardadas, favoritos y mensajes recientes), de modo que las recomendaciones estén
personalizadas. Este contexto era un *helper* previamente **inutilizado** (código
muerto); la mejora lo **cablea** dentro del flujo de generación.

- **Servicio:** `src/modules/recomendador/recomendador-contexto.service.ts`
- **Funciones:** `obtenerContextoUsuarioSpainWay()`, `contextoToTexto()`
- **Cableado:** `recomendador.routes.ts` (`obtenerContextoUsuarioSafe`,
  `construirUserContextParaIa`)

## 2. Datos que recopila

`obtenerContextoUsuarioSpainWay(idUsuario)` ejecuta **tres consultas en paralelo**
(`Promise.all`) contra PostgreSQL:

| Fuente | Consulta Prisma | Límite | Datos |
|--------|-----------------|--------|-------|
| Preferencias | `pref_usuario.findUnique` | 1 | presupuesto, modo_transporte, accesibilidad, con_niños, estilo_viaje, intereses |
| Favoritos | `favoritos.findMany` (orden desc por `creado`) | 12 | POI + municipio + categoría |
| Conversaciones | `conversacion.findMany` (desc) | 4 (× 8 mensajes) | mensajes recientes |

Los mensajes se aplanan, se ordenan cronológicamente y se recortan a los **últimos 10**,
con el contenido limitado a 600 caracteres cada uno.

## 3. Estructura del contexto (`ContextoUsuarioSpainWay`)

```ts
type ContextoUsuarioSpainWay = {
  preferencias: {
    presupuesto: number | null;
    modo_transporte: string | null;
    accesibilidad: string | null;
    con_ninos: boolean | null;
    estilo_viaje: string | null;
    intereses: string | null;
  } | null;
  favoritos: Array<{
    id_poi: number; nombre: string;
    categoria: string | null; municipio: string | null;
    latitud: number | null; longitud: number | null;
  }>;
  mensajes_recientes: Array<{ rol: string; contenido: string; creado: string }>;
};
```

## 4. Conversión a texto (`contextoToTexto`)

Genera una descripción compacta en lenguaje natural que la IA puede leer directamente:

```ts
contextoToTexto(contexto)
// → "Intereses guardados: arte, gastronomía. Estilo de viaje: cultural.
//    Transporte preferido: transporte público. Viaja con niños: no.
//    Favoritos del usuario: Museo del Prado, Parque del Retiro, …
//    Mensajes recientes: user: … | assistant: …"
```

Reglas: incluye intereses, estilo de viaje, transporte, accesibilidad y "viaja con
niños" si están presentes; hasta 8 nombres de favoritos; hasta 6 mensajes recientes.

## 5. Aplanado para la IA (`construirUserContextParaIa`)

El contexto crudo se **aplana a las claves que el motor de IA sabe leer**, duplicando
información relevante en el primer nivel del objeto:

```ts
function construirUserContextParaIa(contexto, contextoTexto) {
  if (!contexto) return undefined;
  return {
    ...contexto,
    intereses: contexto.preferencias?.intereses ?? null,
    estilo_viaje: contexto.preferencias?.estilo_viaje ?? null,
    categorias_preferidas: contexto.favoritos.map(f => f.categoria).filter(Boolean),
    municipios_favoritos:  contexto.favoritos.map(f => f.municipio).filter(Boolean),
    context_text: contextoTexto,
  };
}
```

El resultado viaja a la IA en dos campos del payload (ver `CONTRATO_IA.md`):

- `user_context` — objeto estructurado y aplanado.
- `context_text` — la versión textual (`contextoToTexto`).

## 6. Ejecución segura (nunca bloquea la generación)

El helper se invoca envuelto en `try/catch` para que un fallo de base de datos **jamás**
impida generar el itinerario:

```ts
async function obtenerContextoUsuarioSafe(idUsuario) {
  try {
    return await obtenerContextoUsuarioSpainWay(idUsuario);
  } catch (error) {
    console.log("[recomendador] contexto de usuario no disponible:", …);
    return null;   // ← se continúa sin contexto
  }
}
```

Se obtiene en paralelo con el contexto meteorológico:

```ts
const [contextoUsuario, contextoMeteo] = await Promise.all([
  obtenerContextoUsuarioSafe(idUsuario),
  obtenerContextoMeteoSafe({ lat: baseLat, lon: baseLon, dates, days }),
]);
const contextoTexto = contextoUsuario ? contextoToTexto(contextoUsuario) : "";
const userContextParaIa = construirUserContextParaIa(contextoUsuario, contextoTexto);
```

## 7. Modelo de datos implicado (Prisma)

```prisma
model Pref_usuario {
  presupuesto     Int?
  modo_transporte String?
  accesibilidad   String?
  con_ninos       Boolean?  @map("con_niños")
  estilo_viaje    String?
  intereses       String?   @db.VarChar(500)
  id_usuario      Int       @unique
}
```

Relaciones usadas: `Favoritos` → `Poi` → (`Municipio`, `Categoria_poi`); `Conversacion`
→ `Mensaje`. El contexto, por tanto, es **100 % datos reales** del usuario en la BBDD, no
sintéticos.

## 8. Efecto sobre la personalización

Con este contexto, la IA puede: priorizar categorías afines a los favoritos, respetar el
estilo de viaje y el transporte preferido, tener en cuenta si viaja con niños o
restricciones de accesibilidad, y mantener continuidad con la conversación previa. Todo
ello se persiste además en `preferencias_json` (ver `TRAZABILIDAD_IA_JSON.md`).

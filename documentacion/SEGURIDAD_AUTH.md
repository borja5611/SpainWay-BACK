# Seguridad y autenticación

## Mecanismo

- **JWT** vía `@fastify/jwt`, registrado en `src/app.ts`
  (`app.register(jwt, { secret: JWT_SECRET })`). El token se firma en login
  (`auth.routes.ts`) con `{ id_usuario, email, rol, nombre_usuario }`.
- No hay un `preHandler` global: cada ruta protegida verifica el token de forma
  explícita con el patrón `getUsuarioIdAutenticado(request)`:

```ts
async function getUsuarioIdAutenticado(request) {
  await request.jwtVerify();               // valida la firma del JWT
  const user = request.user as JwtUsuario; // payload del token
  const usuarioId = toInt(user.id_usuario);
  if (usuarioId === null || usuarioId <= 0) throw new Error("Token sin usuario válido");
  return usuarioId;
}
```

## Comprobación de propiedad (ownership)

Las rutas que operan sobre recursos del usuario validan la pertenencia:

- `existeItinerarioDelUsuario(idItinerario, idUsuario)` →
  `where: { id_itinerario, id_usuario }`.
- `validarUsuarioDeRuta(idRuta, idToken)` compara el id de la ruta con el del token.

## Endpoint de auditoría (nuevo)

`GET /api/itinerarios/:idItinerario/auditoria` aplica **ambas** capas:

1. `getUsuarioIdAutenticado` → 401 si no hay token válido.
2. `findFirst({ where: { id_itinerario, id_usuario } })` → 404 si no existe o no
   pertenece al usuario.

Solo entonces se devuelve la traza de decisión. Ver `ENDPOINT_AUDITORIA.md`.

## Consideración conocida (documentada)

`POST /api/recomendador/generar` y `POST /api/chat-acciones/:id/procesar`
confían en el `id_usuario` del cuerpo de la petición (diseño previo, mantenido
por **compatibilidad con el frontend actual**). Es una consideración de
seguridad conocida: la recomendación de mejora futura es exigir `jwtVerify` en
esas rutas y derivar el `id_usuario` del token, alineándolas con el resto.

## Secretos y despliegue

- `JWT_SECRET` es obligatorio en producción (`config/env.ts` lanza error si
  falta con `NODE_ENV=production`). En desarrollo hay un valor por defecto.
- No se han introducido secretos ni claves reales en el repositorio.

## Evidencia para la memoria

- Respuesta 401 al llamar a `/auditoria` sin token.
- Respuesta 404 al pedir la auditoría de un itinerario de otro usuario.
- Fragmento de `getUsuarioIdAutenticado` (Anexo E / Capítulo 3).

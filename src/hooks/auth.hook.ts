import { FastifyReply, FastifyRequest } from "fastify";

/**
 * Forma del payload que SpainWay firma dentro del JWT de acceso.
 * Se corresponde con lo que emiten `/api/auth/login`, `/register`, `/refresh`
 * y el callback de Google (ver `modules/auth/auth.routes.ts`).
 */
export type JwtUsuario = {
  id_usuario?: number;
  email?: string;
  rol?: string;
  nombre_usuario?: string;
};

/** Convierte un valor desconocido en un entero, o `null` si no lo es. */
export function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/**
 * Devuelve el id del usuario autenticado a partir del JWT del `Authorization`.
 * Lanza si el token es inválido, falta o no contiene un `id_usuario` válido.
 *
 * Pensado para handlers que, además de exigir autenticación, necesitan cargar
 * el recurso desde la base de datos para comprobar su propiedad (p. ej. borrar
 * una conversación identificada por su propio id, no por el id de usuario).
 */
export async function getUsuarioIdAutenticado(request: FastifyRequest): Promise<number> {
  await request.jwtVerify();
  const user = request.user as JwtUsuario;
  const usuarioId = toInt(user?.id_usuario);

  if (usuarioId === null || usuarioId <= 0) {
    throw new Error("Token sin usuario válido");
  }

  return usuarioId;
}

/**
 * Comprueba que el parámetro de ruta identifica al mismo usuario que porta el token.
 * Es la pieza que evita el IDOR (Broken Object Level Authorization): sin ella,
 * un usuario autenticado podría leer o modificar recursos de otro cambiando el `:id`.
 */
export function validarUsuarioDeRuta(usuarioRuta: unknown, usuarioToken: number): boolean {
  const usuarioRutaId = toInt(usuarioRuta);
  return usuarioRutaId !== null && usuarioRutaId === usuarioToken;
}

/** Id del usuario autenticado tras `requiereAutenticacion` (asume hook previo ejecutado). */
export function usuarioAutenticadoId(request: FastifyRequest): number {
  const user = request.user as JwtUsuario;
  return toInt(user?.id_usuario) ?? 0;
}

/** ¿El usuario autenticado tiene rol de administrador? */
export function esAdministrador(request: FastifyRequest): boolean {
  const user = request.user as JwtUsuario;
  return (user?.rol ?? "").trim().toLowerCase() === "admin";
}

/**
 * preHandler: exige un JWT válido y adjunta `request.user` (vía `jwtVerify`).
 * Responde 401 si el token falta, está caducado o es inválido.
 *
 * Es el primer nivel de defensa: "¿quién eres?". Debe ir SIEMPRE antes de
 * cualquier comprobación de propiedad.
 */
export async function requiereAutenticacion(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    const user = request.user as JwtUsuario;
    const id = toInt(user?.id_usuario);
    if (id === null || id <= 0) {
      return reply.code(401).send({ message: "No autenticado: el token no identifica a un usuario válido" });
    }
  } catch {
    return reply.code(401).send({ message: "No autenticado" });
  }
}

/**
 * preHandler factory: segundo nivel de defensa, "¿es tuyo?". Valida que el
 * usuario autenticado es el dueño del recurso, comparando el parámetro de ruta
 * indicado (p. ej. `"id"` o `"id_usuario"`) con el id que porta el token.
 *
 * Debe encadenarse DESPUÉS de `requiereAutenticacion`. Un administrador
 * (`rol === "admin"`) puede acceder a cualquier recurso; hoy no existe un panel
 * de administración, pero el hook lo contempla para una futura ampliación.
 *
 * Uso: `{ preHandler: [requiereAutenticacion, validarPropiedadRecurso("id")] }`.
 */
export function validarPropiedadRecurso(paramName: string) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const user = request.user as JwtUsuario;
    const tokenId = toInt(user?.id_usuario);

    if (tokenId === null) {
      return reply.code(401).send({ message: "No autenticado" });
    }

    if (esAdministrador(request)) return;

    const params = request.params as Record<string, unknown>;
    const rutaId = toInt(params?.[paramName]);

    if (rutaId === null || rutaId !== tokenId) {
      return reply.code(403).send({ message: "No puedes acceder a recursos de otro usuario" });
    }
  };
}

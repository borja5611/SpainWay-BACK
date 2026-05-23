import { prisma } from "../../lib/prisma";

export type ContextoUsuarioSpainWay = {
  preferencias: {
    presupuesto: number | null;
    modo_transporte: string | null;
    accesibilidad: string | null;
    con_ninos: boolean | null;
    estilo_viaje: string | null;
    intereses: string | null;
  } | null;
  favoritos: Array<{
    id_poi: number;
    nombre: string;
    categoria: string | null;
    municipio: string | null;
    latitud: number | null;
    longitud: number | null;
  }>;
  mensajes_recientes: Array<{
    rol: string;
    contenido: string;
    creado: string;
  }>;
};

function fechaMs(value: Date | string | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function contextoToTexto(contexto: ContextoUsuarioSpainWay): string {
  const partes: string[] = [];

  if (contexto.preferencias) {
    const p = contexto.preferencias;
    if (p.intereses) partes.push(`Intereses guardados: ${p.intereses}.`);
    if (p.estilo_viaje) partes.push(`Estilo de viaje: ${p.estilo_viaje}.`);
    if (p.modo_transporte) partes.push(`Transporte preferido: ${p.modo_transporte}.`);
    if (p.accesibilidad) partes.push(`Accesibilidad/restricciones: ${p.accesibilidad}.`);
    if (p.con_ninos !== null) partes.push(`Viaja con niños: ${p.con_ninos ? "sí" : "no"}.`);
  }

  if (contexto.favoritos.length > 0) {
    partes.push(
      `Favoritos del usuario: ${contexto.favoritos
        .slice(0, 8)
        .map((fav) => fav.nombre)
        .join(", ")}.`,
    );
  }

  if (contexto.mensajes_recientes.length > 0) {
    partes.push(
      `Mensajes recientes: ${contexto.mensajes_recientes
        .slice(-6)
        .map((msg) => `${msg.rol}: ${msg.contenido}`)
        .join(" | ")}.`,
    );
  }

  return partes.join(" ");
}

export async function obtenerContextoUsuarioSpainWay(
  idUsuario: number,
): Promise<ContextoUsuarioSpainWay> {
  const [preferencias, favoritos, conversaciones] = await Promise.all([
    prisma.pref_usuario.findUnique({
      where: { id_usuario: idUsuario },
      select: {
        presupuesto: true,
        modo_transporte: true,
        accesibilidad: true,
        con_ninos: true,
        estilo_viaje: true,
        intereses: true,
      },
    }),

    prisma.favoritos.findMany({
      where: { id_usuario: idUsuario },
      orderBy: { creado: "desc" },
      take: 12,
      include: {
        poi: {
          include: {
            municipio: true,
            categoria_poi: true,
          },
        },
      },
    }),

    prisma.conversacion.findMany({
      where: { id_usuario: idUsuario },
      orderBy: { creado: "desc" },
      take: 4,
      include: {
        mensajes: {
          orderBy: { creado: "desc" },
          take: 8,
        },
      },
    }),
  ]);

  const mensajes = conversaciones
    .flatMap((conv) => conv.mensajes)
    .sort((a, b) => fechaMs(a.creado) - fechaMs(b.creado))
    .slice(-10)
    .map((msg) => ({
      rol: String(msg.rol ?? "user"),
      contenido: String(msg.contenido ?? "").slice(0, 600),
    creado: msg.creado instanceof Date
    ? msg.creado.toISOString()
    : new Date(fechaMs(msg.creado)).toISOString(),
    }));

  return {
    preferencias: preferencias ?? null,
    favoritos: favoritos
      .filter((fav) => fav.poi)
      .map((fav) => ({
        id_poi: fav.id_poi,
        nombre: fav.poi?.nombre ?? "POI",
        categoria:
          fav.poi?.categoria_poi?.nombre ??
          fav.poi?.tipo ??
          fav.poi?.subcategoria ??
          null,
        municipio: fav.poi?.municipio?.nombre ?? null,
        latitud: fav.poi?.latitud ?? null,
        longitud: fav.poi?.longitud ?? null,
      })),
    mensajes_recientes: mensajes,
  };
}

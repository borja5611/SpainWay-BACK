import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

export async function guardarSeleccion(req: Request, res: Response) {
  try {
    const { itinerarioId } = req.params;
    const { diaNumero, momento, lugarRestauracionId } = req.body;

    const saved = await prisma.itinerarioRestauracion.upsert({
      where: {
        itinerarioId_diaNumero_momento: {
          itinerarioId: Number(itinerarioId),
          diaNumero,
          momento,
        },
      },
      update: {
        lugarRestauracionId,
      },
      create: {
        itinerarioId: Number(itinerarioId),
        diaNumero,
        momento,
        lugarRestauracionId,
      },
    });

    res.json(saved);
  } catch (e) {
    res.status(500).json({ error: "Error guardando selección" });
  }
}
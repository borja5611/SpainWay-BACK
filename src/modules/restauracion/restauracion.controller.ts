import { Request, Response } from "express";
import { buscarRestaurantes } from "./restauracion.service";

export async function getRestaurantes(req: Request, res: Response) {
  try {
    const { lat, lng, radio } = req.query;

    const data = await buscarRestaurantes({
      lat: Number(lat),
      lng: Number(lng),
      radio: Number(radio) || 1000,
    });

    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error buscando restaurantes" });
  }
}
import axios from "axios";
import { prisma } from "../../lib/prisma";

const FSQ_URL = "https://api.foursquare.com/v3/places/search";

export async function buscarRestaurantes({
  lat,
  lng,
  radio = 1000,
  categoria = "13065",
}: {
  lat: number;
  lng: number;
  radio?: number;
  categoria?: string;
}) {
  const response = await axios.get(FSQ_URL, {
    headers: {
      Authorization: process.env.FSQ_API_KEY!,
    },
    params: {
      ll: `${lat},${lng}`,
      radius: radio,
      categories: categoria,
      limit: 10,
    },
  });

  const lugares = response.data.results ?? [];
  const guardados = [];

  for (const l of lugares) {
    const latitud = l.geocodes?.main?.latitude;
    const longitud = l.geocodes?.main?.longitude;

    if (!l.fsq_id || latitud == null || longitud == null) continue;

    const saved = await prisma.lugarRestauracion.upsert({
      where: {
        proveedor_externalId: {
          proveedor: "foursquare",
          externalId: l.fsq_id,
        },
      },
      update: {
        nombre: l.name,
        categoria: l.categories?.[0]?.name || null,
        direccion: l.location?.formatted_address || null,
        latitud,
        longitud,
        distancia: l.distance ?? null,
      },
      create: {
        proveedor: "foursquare",
        externalId: l.fsq_id,
        nombre: l.name,
        categoria: l.categories?.[0]?.name || null,
        direccion: l.location?.formatted_address || null,
        latitud,
        longitud,
        distancia: l.distance ?? null,
      },
    });

    guardados.push(saved);
  }

  return guardados;
}
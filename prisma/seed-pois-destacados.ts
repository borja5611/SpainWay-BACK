import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { prisma } from "../src/lib/prisma";

type Row = {
  ccaa?: string;
  comunidad?: string;
  provincia?: string;
  municipio?: string;
  poi_canonico?: string;
  fuente?: string;
  fuente_tipo?: string;
  url_fuente?: string;
  prioridad_fuente?: string;
  matched_global_id?: string;
  matched_name?: string;
  match_confianza?: string;
  match_reason?: string;
  match_status?: string;
  imagen_url?: string;
};

function limpiar(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

function numeroSeguro(valor: unknown, fallback = 0): number {
  const n = Number(String(valor ?? "").trim().replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  const csvPath = path.join(
    process.cwd(),
    "data",
    "procesado",
    "POIS_DESTACADOS_CCAA_FINAL.csv"
  );

  if (!fs.existsSync(csvPath)) {
    throw new Error(`No existe el CSV: ${csvPath}`);
  }

  const raw = fs.readFileSync(csvPath, "utf-8");
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  }) as Row[];

  console.log(`📄 Filas leídas: ${rows.length}`);

  const matchedRows = rows.filter((row) => {
    const matchedGlobalId = limpiar(row.matched_global_id);
    const matchStatus = limpiar(row.match_status).toLowerCase();
    return matchedGlobalId !== "" && matchStatus === "matched";
  });

  console.log(`✅ Filas válidas (matched): ${matchedRows.length}`);

  const globalIds = Array.from(
    new Set(
      matchedRows
        .map((row) => limpiar(row.matched_global_id))
        .filter(Boolean)
    )
  );

  const pois = await prisma.poi.findMany({
    where: {
      id_global: {
        in: globalIds,
      },
    },
    select: {
      id_poi: true,
      id_global: true,
    },
  });

  const poiByGlobalId = new Map<string, number>();
  for (const poi of pois) {
    poiByGlobalId.set(poi.id_global, poi.id_poi);
  }

  console.log(`🧭 POIs encontrados en tabla Poi: ${poiByGlobalId.size}`);

  const dataToInsert: Array<{
    id_poi: number;
    comunidad: string;
    ciudad_fuente: string | null;
    provincia_fuente: string | null;
    poi_canonico: string;
    fuente: string;
    fuente_tipo: string;
    url_fuente: string | null;
    prioridad_fuente: number;
    match_confianza: number | null;
    motivo: string | null;
    imagen_url: string | null;
  }> = [];

  let omitidos = 0;

  for (const row of matchedRows) {
    const comunidad = limpiar(row.ccaa || row.comunidad);
    const provincia = limpiar(row.provincia);
    const municipio = limpiar(row.municipio);
    const poiCanonico = limpiar(row.poi_canonico);
    const fuente = limpiar(row.fuente) || "curado_editorial_validado";
    const fuenteTipo = limpiar(row.fuente_tipo) || "curado_manual_validado";
    const urlFuente = limpiar(row.url_fuente);
    const matchedGlobalId = limpiar(row.matched_global_id);
    const prioridadFuente = numeroSeguro(row.prioridad_fuente, 0);
    const matchConfianzaRaw = limpiar(row.match_confianza);
    const matchConfianza =
      matchConfianzaRaw !== "" ? numeroSeguro(matchConfianzaRaw, 0) : null;
    const motivo = limpiar(row.match_reason);
    const imagenUrl = limpiar(row.imagen_url);

    if (!comunidad) {
      console.warn(`⚠️ Fila sin comunidad para ${poiCanonico || matchedGlobalId}`);
      omitidos++;
      continue;
    }

    if (!poiCanonico) {
      console.warn(`⚠️ Fila sin poi_canonico para ${matchedGlobalId}`);
      omitidos++;
      continue;
    }

    const idPoi = poiByGlobalId.get(matchedGlobalId);

    if (!idPoi) {
      console.warn(`⚠️ No encontrado en Poi: ${matchedGlobalId}`);
      omitidos++;
      continue;
    }

    dataToInsert.push({
      id_poi: idPoi,
      comunidad,
      ciudad_fuente: municipio || null,
      provincia_fuente: provincia || null,
      poi_canonico: poiCanonico,
      fuente,
      fuente_tipo: fuenteTipo,
      url_fuente: urlFuente || null,
      prioridad_fuente: prioridadFuente,
      match_confianza: matchConfianza,
      motivo: motivo || null,
      imagen_url: imagenUrl || null,
    });
  }

  const uniqueMap = new Map<string, (typeof dataToInsert)[number]>();
  for (const item of dataToInsert) {
    const key = `${item.id_poi}__${item.comunidad}__${item.poi_canonico}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, item);
    }
  }

  const finalRows = Array.from(uniqueMap.values());

  console.log(`🧹 Filas finales tras deduplicar: ${finalRows.length}`);
  console.log(`⚠️ Omitidos en preparación: ${omitidos}`);

  await prisma.$transaction(async (tx) => {
    await tx.poi_destacado_ccaa.deleteMany({});
    console.log("🧹 Tabla Poi_destacado_ccaa limpiada");

    if (finalRows.length > 0) {
      await tx.poi_destacado_ccaa.createMany({
        data: finalRows,
        skipDuplicates: true,
      });
    }
  });

  const resumen = await prisma.poi_destacado_ccaa.groupBy({
    by: ["comunidad"],
    _count: {
      id_poi_destacado_ccaa: true,
    },
    orderBy: {
      comunidad: "asc",
    },
  });

  console.log("✅ Importación completada");
  console.log(`✅ Insertados finales: ${finalRows.length}`);
  console.table(
    resumen.map((r) => ({
      comunidad: r.comunidad,
      total: r._count.id_poi_destacado_ccaa,
    }))
  );
}

main()
  .catch((error) => {
    console.error("❌ Error importando POIs destacados:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
  
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { prisma } from "../src/lib/prisma";

type Row = {
  id_poi_destacado_ccaa?: string;
  id_poi?: string;
  comunidad?: string;
  ccaa?: string;
  ciudad_fuente?: string;
  municipio?: string;
  provincia_fuente?: string;
  provincia?: string;
  poi_canonico?: string;
  fuente?: string;
  fuente_tipo?: string;
  url_fuente?: string;
  prioridad_fuente?: string;
  match_confianza?: string;
  motivo?: string;
  match_reason?: string;
  created_at?: string;
  imagen_url?: string;
  // compatibilidad con columnas antiguas
  matched_global_id?: string;
  match_status?: string;
};

function limpiar(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

function limpiarONull(valor: unknown): string | null {
  const s = limpiar(valor);
  return s === "" || s.toLowerCase() === "nan" || s.toLowerCase() === "null" ? null : s;
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
    "POIS_DESTACADOS_NORMALIZED.csv"
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

  // Diagnóstico: columnas detectadas
  if (rows.length > 0) {
    console.log("📋 Columnas detectadas:", Object.keys(rows[0]));
  }

  let omitidos = 0;
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

  for (const row of rows) {
    // ── Resolver id_poi ──────────────────────────────────────────────────────
    // El CSV nuevo tiene id_poi directamente como número
    const idPoiRaw = limpiar(row.id_poi);
    const idPoi = idPoiRaw !== "" ? parseInt(idPoiRaw, 10) : NaN;

    if (isNaN(idPoi)) {
      console.warn(`⚠️ Fila sin id_poi válido: ${limpiar(row.poi_canonico)}`);
      omitidos++;
      continue;
    }

    // ── Campos de texto ──────────────────────────────────────────────────────
    const comunidad =
      limpiarONull(row.comunidad) ?? limpiarONull(row.ccaa);
    const ciudadFuente =
      limpiarONull(row.ciudad_fuente) ?? limpiarONull(row.municipio);
    const provinciaFuente =
      limpiarONull(row.provincia_fuente) ?? limpiarONull(row.provincia);
    const poiCanonico = limpiarONull(row.poi_canonico);
    const fuente =
      limpiarONull(row.fuente) ?? "curado_editorial_validado";
    const fuenteTipo =
      limpiarONull(row.fuente_tipo) ?? "curado_manual_validado";
    const urlFuente = limpiarONull(row.url_fuente);
    const prioridadFuente = numeroSeguro(row.prioridad_fuente, 0);
    const matchConfianzaRaw = limpiar(row.match_confianza);
    const matchConfianza =
      matchConfianzaRaw !== "" ? numeroSeguro(matchConfianzaRaw, 0) : null;
    const motivo =
      limpiarONull(row.motivo) ?? limpiarONull(row.match_reason);

    // ── imagen_url: columna clave que faltaba en el script original ──────────
    const imagenUrl = limpiarONull(row.imagen_url);

    if (!comunidad) {
      console.warn(`⚠️ Fila sin comunidad: id_poi=${idPoi} | ${poiCanonico}`);
      omitidos++;
      continue;
    }

    if (!poiCanonico) {
      console.warn(`⚠️ Fila sin poi_canonico: id_poi=${idPoi}`);
      omitidos++;
      continue;
    }

    dataToInsert.push({
      id_poi: idPoi,
      comunidad,
      ciudad_fuente: ciudadFuente,
      provincia_fuente: provinciaFuente,
      poi_canonico: poiCanonico,
      fuente,
      fuente_tipo: fuenteTipo,
      url_fuente: urlFuente,
      prioridad_fuente: prioridadFuente,
      match_confianza: matchConfianza,
      motivo,
      imagen_url: imagenUrl,
    });
  }

  // ── Deduplicación ─────────────────────────────────────────────────────────
  const uniqueMap = new Map<string, (typeof dataToInsert)[number]>();
  for (const item of dataToInsert) {
    const key = `${item.id_poi}__${item.comunidad}__${item.poi_canonico}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, item);
    }
  }

  const finalRows = Array.from(uniqueMap.values());

  console.log(`🧹 Filas finales tras deduplicar: ${finalRows.length}`);
  console.log(`⚠️  Omitidos en preparación: ${omitidos}`);

  // Diagnóstico: cuántos tienen imagen_url
  const conImagen = finalRows.filter((r) => r.imagen_url !== null).length;
  console.log(`🖼️  Filas con imagen_url: ${conImagen} / ${finalRows.length}`);

  // ── Inserción en transacción ──────────────────────────────────────────────
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

  // ── Resumen final ─────────────────────────────────────────────────────────
  const resumen = await prisma.poi_destacado_ccaa.groupBy({
    by: ["comunidad"],
    _count: { id_poi_destacado_ccaa: true },
    orderBy: { comunidad: "asc" },
  });

  console.log("✅ Importación completada");
  console.log(`✅ Insertados: ${finalRows.length}`);
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
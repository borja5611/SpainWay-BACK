import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";


const PROVINCIA_TO_CCAA: Record<string, string> = {
  "a coruna": "Galicia",
  "alava": "Pais Vasco",
  "albacete": "Castilla-La Mancha",
  "alicante": "Comunidad Valenciana",
  "almeria": "Andalucia",
  "asturias": "Asturias",
  "avila": "Castilla y Leon",
  "badajoz": "Extremadura",
  "barcelona": "Catalunya",
  "burgos": "Castilla y Leon",
  "caceres": "Extremadura",
  "cadiz": "Andalucia",
  "cantabria": "Cantabria",
  "castellon": "Comunidad Valenciana",
  "ceuta": "Ceuta",
  "ciudad real": "Castilla-La Mancha",
  "cordoba": "Andalucia",
  "cuenca": "Castilla-La Mancha",
  "girona": "Catalunya",
  "granada": "Andalucia",
  "guadalajara": "Castilla-La Mancha",
  "guipuzcoa": "Pais Vasco",
  "huelva": "Andalucia",
  "huesca": "Aragon",
  "illes balears": "Illes Balears",
  "jaen": "Andalucia",
  "la rioja": "La Rioja",
  "las palmas": "Canarias",
  "leon": "Castilla y Leon",
  "lleida": "Catalunya",
  "lugo": "Galicia",
  "madrid": "Comunidad de Madrid",
  "malaga": "Andalucia",
  "melilla": "Melilla",
  "murcia": "Region de Murcia",
  "navarra": "Navarra",
  "ourense": "Galicia",
  "palencia": "Castilla y Leon",
  "pontevedra": "Galicia",
  "salamanca": "Castilla y Leon",
  "santa cruz de tenerife": "Canarias",
  "segovia": "Castilla y Leon",
  "sevilla": "Andalucia",
  "soria": "Castilla y Leon",
  "tarragona": "Catalunya",
  "teruel": "Aragon",
  "toledo": "Castilla-La Mancha",
  "valencia": "Comunidad Valenciana",
  "valladolid": "Castilla y Leon",
  "vizcaya": "Pais Vasco",
  "zamora": "Castilla y Leon",
  "zaragoza": "Aragon",
};

function normalizarClaveTerritorio(valor: string | null): string | null {
  const texto = limpiarTexto(valor);
  if (!texto) return null;

  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function resolverCcaa(ccaaOriginal: string | null, provincia: string | null): string | null {
  const provinciaKey = normalizarClaveTerritorio(provincia);

  if (provinciaKey && PROVINCIA_TO_CCAA[provinciaKey]) {
    return PROVINCIA_TO_CCAA[provinciaKey];
  }

  return limpiarTexto(ccaaOriginal);
}

type CsvRow = {
  GLOBAL_ID: string;
  NAME: string;
  TYPE: string;
  CATEGORY: string;
  SUBCATEGORY?: string;
  CCAA: string;
  PROVINCE?: string;
  MUNICIPALITY?: string;
  ADDRESS?: string;
  LAT: string | number;
  LON: string | number;
  SOURCE: string;
  QUALITY_SCORE?: string | number;
  POPULARITY_PROXY?: string | number;
  CLUSTER_ID?: string;
  SEASON_PREF?: string;
  DESCRIPTION_SNIPPET?: string;
  VALID: string | boolean;
};

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL no está definida");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

let provinciasDescartadas = 0;
let municipiosDescartados = 0;

function limpiarTexto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim().replace(/\s+/g, " ");
  if (!texto || texto.toLowerCase() === "nan" || texto.toLowerCase() === "null") {
    return null;
  }
  return texto;
}

function limpiarSlug(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseBool(valor: unknown): boolean {
  if (typeof valor === "boolean") return valor;
  const texto = String(valor).trim().toLowerCase();
  return texto === "true" || texto === "1" || texto === "yes";
}

function parseFloatOrNull(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const num = Number(valor);
  return Number.isFinite(num) ? num : null;
}

function normalizarProvincia(valor: string | null): string | null {
  const texto = limpiarTexto(valor);
  if (!texto) return null;

  if (texto.length > 80) {
    provinciasDescartadas++;
    return null;
  }

  return texto;
}

function normalizarMunicipio(valor: string | null): string | null {
  const texto = limpiarTexto(valor);
  if (!texto) return null;

  if (texto.length > 120) {
    municipiosDescartados++;
    return null;
  }

  return texto;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function borrarDatosPrevios() {
  console.log("🧹 Borrando datos previos y reseteando ids...");

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Mensaje",
      "Conversacion",
      "Analisis_Evento",
      "Item_interaccion",
      "Favoritos",
      "Elemento_Itinerario",
      "Dia_Itinerario",
      "Itinerario",
      "Programación_poi",
      "Evento",
      "Poi",
      "Categoria_poi",
      "Municipio",
      "Provincia",
      "Comunidad",
      "Pref_usuario",
      "Usuario"
    RESTART IDENTITY CASCADE;
  `);

  console.log("✅ Datos previos borrados e ids reiniciados");
}

async function main() {
  const csvPath = path.join(
    process.cwd(),
    "data",
    "procesado",
    "NATIONAL_MASTER_POIS_ENRIQUECIDO.csv"
  );

  if (!fs.existsSync(csvPath)) {
    throw new Error(`No existe el CSV enriquecido en: ${csvPath}`);
  }

  console.log("📄 Leyendo CSV enriquecido...");
  const fileContent = fs.readFileSync(csvPath, "utf-8");

  const rawRows = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  }) as CsvRow[];

  console.log(`✅ Filas leídas: ${rawRows.length}`);

  const seen = new Set<string>();

  const rows = rawRows
    .map((r) => ({
      id_global: limpiarTexto(r.GLOBAL_ID),
      nombre: limpiarTexto(r.NAME),
      tipo: limpiarTexto(r.TYPE),
      categoria: limpiarTexto(r.CATEGORY),
      subcategoria: limpiarTexto(r.SUBCATEGORY),
      ccaa: limpiarTexto(r.CCAA),
      provincia: normalizarProvincia(r.PROVINCE ?? null),
      municipio: normalizarMunicipio(r.MUNICIPALITY ?? null),
      direccion: limpiarTexto(r.ADDRESS),
      latitud: parseFloatOrNull(r.LAT),
      longitud: parseFloatOrNull(r.LON),
      origen: limpiarTexto(r.SOURCE),
      puntuacion: parseFloatOrNull(r.QUALITY_SCORE),
      popularidad: parseFloatOrNull(r.POPULARITY_PROXY),
      id_cluster: limpiarTexto(r.CLUSTER_ID),
      temporada: limpiarTexto(r.SEASON_PREF),
      descripcion: limpiarTexto(r.DESCRIPTION_SNIPPET),
      valido: parseBool(r.VALID),
    }))
    .filter((r) => r.id_global && r.nombre && r.tipo && r.categoria && r.ccaa)
    .filter((r) => {
      if (!r.id_global) return false;
      if (seen.has(r.id_global)) return false;
      seen.add(r.id_global);
      return true;
    });

  console.log(`✅ Filas válidas tras limpieza: ${rows.length}`);
  console.log(`⚠️ Provincias descartadas por texto sospechoso: ${provinciasDescartadas}`);
  console.log(`⚠️ Municipios descartados por texto sospechoso: ${municipiosDescartados}`);

  await borrarDatosPrevios();

  console.log("🏛️ Insertando comunidades...");
  const comunidadesUnicas = Array.from(
    new Map(
      rows.map((r) => [
        r.ccaa!,
        {
          nombre: r.ccaa!,
          slug: limpiarSlug(r.ccaa!),
        },
      ])
    ).values()
  );

  await prisma.comunidad.createMany({
    data: comunidadesUnicas,
    skipDuplicates: true,
  });

  const comunidades = await prisma.comunidad.findMany();
  const comunidadMap = new Map(comunidades.map((c) => [c.nombre, c.id_CCAA]));

  console.log("🗺️ Insertando provincias...");
  const provinciaMapTemp = new Map<string, { nombre: string; slug: string; id_CCAA: number }>();

  for (const r of rows) {
    if (!r.provincia || !r.ccaa) continue;

    const id_CCAA = comunidadMap.get(r.ccaa);
    if (!id_CCAA) continue;

    const key = `${r.ccaa}||${r.provincia}`;
    if (!provinciaMapTemp.has(key)) {
      provinciaMapTemp.set(key, {
        nombre: r.provincia,
        slug: limpiarSlug(r.provincia),
        id_CCAA,
      });
    }
  }

  await prisma.provincia.createMany({
    data: Array.from(provinciaMapTemp.values()),
    skipDuplicates: true,
  });

  const provincias = await prisma.provincia.findMany();
  const provinciaMap = new Map(
    provincias.map((p) => [`${p.id_CCAA}||${p.nombre}`, p.id_provincia])
  );

  console.log("🏙️ Insertando municipios...");
  const municipioMapTemp = new Map<
    string,
    { nombre: string; latitud: number | null; longitud: number | null; id_provincia: number }
  >();

  for (const r of rows) {
    if (!r.municipio || !r.provincia || !r.ccaa) continue;

    const id_CCAA = comunidadMap.get(r.ccaa);
    if (!id_CCAA) continue;

    const id_provincia = provinciaMap.get(`${id_CCAA}||${r.provincia}`);
    if (!id_provincia) continue;

    const key = `${id_provincia}||${r.municipio}`;
    if (!municipioMapTemp.has(key)) {
      municipioMapTemp.set(key, {
        nombre: r.municipio,
        latitud: r.latitud,
        longitud: r.longitud,
        id_provincia,
      });
    }
  }

  await prisma.municipio.createMany({
    data: Array.from(municipioMapTemp.values()),
    skipDuplicates: true,
  });

  const municipios = await prisma.municipio.findMany();
  const municipioMap = new Map(
    municipios.map((m) => [`${m.id_provincia}||${m.nombre}`, m.id_municipio])
  );

  console.log("🏷️ Insertando categorías...");
  const categoriasUnicas = Array.from(
    new Map(
      rows.map((r) => [
        r.categoria!,
        {
          nombre: r.categoria!,
          slug: limpiarSlug(r.categoria!),
        },
      ])
    ).values()
  );

  await prisma.categoria_poi.createMany({
    data: categoriasUnicas,
    skipDuplicates: true,
  });

  const categorias = await prisma.categoria_poi.findMany();
  const categoriaMap = new Map(categorias.map((c) => [c.nombre, c.id_categoria_poi]));

  console.log("📍 Preparando POIs...");
  const ahora = new Date();

  const pois = rows.map((r) => {
    let id_municipio: number | null = null;

    if (r.municipio && r.provincia && r.ccaa) {
      const id_CCAA = comunidadMap.get(r.ccaa);
      if (id_CCAA) {
        const id_provincia = provinciaMap.get(`${id_CCAA}||${r.provincia}`);
        if (id_provincia) {
          id_municipio = municipioMap.get(`${id_provincia}||${r.municipio}`) ?? null;
        }
      }
    }

    const id_categoria_poi = categoriaMap.get(r.categoria!);

    if (!id_categoria_poi) {
      throw new Error(`No se encontró categoría para: ${r.categoria}`);
    }

    return {
      id_global: r.id_global!,
      nombre: r.nombre!,
      tipo: r.tipo!,
      subcategoria: r.subcategoria,
      direccion: r.direccion,
      latitud: r.latitud,
      longitud: r.longitud,
      descripcion: r.descripcion,
      temporada: r.temporada,
      puntuacion: r.puntuacion,
      popularidad: r.popularidad,
      id_cluster: r.id_cluster,
      origen: r.origen,
      valido: r.valido,
      creado: ahora,
      actualizado: ahora,
      id_municipio,
      id_categoria_poi,
    };
  });

  console.log("📍 Insertando POIs por lotes...");
  const bloques = chunkArray(pois, 1000);

  for (let i = 0; i < bloques.length; i++) {
    await prisma.poi.createMany({
      data: bloques[i],
      skipDuplicates: true,
    });
    console.log(`✅ Lote ${i + 1}/${bloques.length} insertado`);
  }

  const [
    totalComunidad,
    totalProvincia,
    totalMunicipio,
    totalCategoria,
    totalPoi,
    totalUsuario,
    totalFavoritos,
    totalItinerario,
    totalPoisSinMunicipio,
  ] = await Promise.all([
    prisma.comunidad.count(),
    prisma.provincia.count(),
    prisma.municipio.count(),
    prisma.categoria_poi.count(),
    prisma.poi.count(),
    prisma.usuario.count(),
    prisma.favoritos.count(),
    prisma.itinerario.count(),
    prisma.poi.count({ where: { id_municipio: null } }),
  ]);

  console.log("🎉 Importación completada");
  console.log({
    Comunidad: totalComunidad,
    Provincia: totalProvincia,
    Municipio: totalMunicipio,
    Categoria_poi: totalCategoria,
    Poi: totalPoi,
    Poi_sin_municipio: totalPoisSinMunicipio,
    Usuario: totalUsuario,
    Favoritos: totalFavoritos,
    Itinerario: totalItinerario,
  });
}

main()
  .catch((e) => {
    console.error("❌ Error importando CSV real:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
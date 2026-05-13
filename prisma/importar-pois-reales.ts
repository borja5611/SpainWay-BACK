import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const PROVINCIA_TO_CCAA: Record<string, string> = {
  "almeria": "Andalucía", "jaen": "Andalucía", "cadiz": "Andalucía",
  "sevilla": "Andalucía", "cordoba": "Andalucía", "huelva": "Andalucía",
  "granada": "Andalucía", "malaga": "Andalucía",
  "asturias": "Asturias",
  "illes balears": "Illes Balears", "baleares": "Illes Balears", "islas baleares": "Illes Balears",
  "cantabria": "Cantabria",
  "girona": "Catalunya", "barcelona": "Catalunya", "lleida": "Catalunya", "tarragona": "Catalunya",
  "madrid": "Comunidad de Madrid",
  "alicante": "Comunidad Valenciana", "valencia": "Comunidad Valenciana", "castellon": "Comunidad Valenciana",
  "las palmas": "Canarias", "santa cruz de tenerife": "Canarias",
};

const SUBCAT_MAP: Record<string, string | null> = {
  "espacio natural": "espacio_natural", "espacio_natural": "espacio_natural",
  "parque natural": "parque_natural", "parque nacional": "parque_nacional",
  "reserva natural": "reserva_natural", "jardin": "jardin_parque",
  "jardin / parque": "jardin_parque", "jardin - parque": "jardin_parque",
  "0561s_zona verde": "jardin_parque", "zona verde": "jardin_parque",
  "bosque": "bosque", "cascada": "cascada", "lago": "lago_embalse",
  "embalse": "lago_embalse", "rio": "rio", "cueva": "cueva_gruta",
  "gruta": "cueva_gruta", "acantilado": "acantilado", "volcan": "volcan",
  "playa": "playa", "cala": "cala", "playa urbana": "playa",
  "monumento": "monumento", "0525p_monumento": "monumento",
  "yacimiento arqueologico": "yacimiento_arqueologico",
  "0558p_yacimiento arqueologico": "yacimiento_arqueologico",
  "restos arqueologicos": "yacimiento_arqueologico",
  "museo": "museo", "galeria de arte": "galeria_arte",
  "centro cultural": "centro_cultural", "teatro": "teatro",
  "iglesia": "iglesia", "catedral": "catedral", "ermita": "ermita",
  "monasterio": "monasterio", "convento": "convento",
  "capilla": "capilla", "castillo": "castillo", "fortaleza": "fortaleza",
  "palacio": "palacio", "torre": "torre", "faro": "faro", "muralla": "muralla",
  "mirador": "mirador", "punto panoramico": "mirador",
  "parque de atracciones": "parque_atracciones", "zoo": "zoo", "acuario": "acuario",
  "campo de futbol": "campo_futbol", "campo - de - futbol": "campo_futbol",
  "campo_de_futbol": "campo_futbol", "estadio": "estadio",
  "piscina": "piscina", "polideportivo": "polideportivo",
  "0564s_instalacion deportiva": "pista_deportiva",
  "campo de golf": "campo_golf", "senderismo": "senderismo",
  "restaurante": "restaurante", "bar": "bar", "cafeteria": "cafeteria",
  "bodega": "bodega", "mercado": "mercado",
  "hotel": "hotel", "alojamiento": "alojamiento", "camping": "camping",
  "oficina de turismo": "oficina_turismo",
  "area recreativa": "area_recreativa", "area de descanso": "area_recreativa",
  "ruta": "ruta", "camino": "camino", "via verde": "via_verde",
  "camino de santiago": "camino_santiago",
  "l": null, "p": null, "up": null,
};

const TIPO_MAP: Record<string, string> = {
  "naturaleza": "Naturaleza", "nature": "Naturaleza",
  "playa": "Playa", "beach": "Playa",
  "cultura": "Cultura", "culture": "Cultura", "cultural": "Cultura",
  "patrimonio": "Patrimonio", "heritage": "Patrimonio",
  "arquitectura": "Arquitectura", "architecture": "Arquitectura",
  "religioso": "Religioso", "religious": "Religioso",
  "ocio": "Ocio", "leisure": "Ocio",
  "deporte": "Deporte", "sport": "Deporte", "sports": "Deporte",
  "gastronomia": "Gastronomia", "gastronomy": "Gastronomia",
  "mirador": "Mirador", "viewpoint": "Mirador",
  "ruta": "Ruta", "route": "Ruta",
  "turismo": "Turismo", "tourism": "Turismo",
};

const CATEGORIA_MAP: Record<string, string> = {
  "naturaleza": "NATURALEZA", "playa": "PLAYA", "cultura": "CULTURA",
  "patrimonio": "PATRIMONIO", "arquitectura": "ARQUITECTURA",
  "religioso": "RELIGIOSO", "ocio": "OCIO", "deporte": "DEPORTE",
  "gastronomia": "GASTRONOMIA", "mirador": "MIRADOR", "ruta": "RUTA",
  "turismo": "TURISMO",
};

type CsvRow = {
  GLOBAL_ID: string; NAME: string; TYPE: string; CATEGORY: string;
  SUBCATEGORY?: string; CCAA: string; PROVINCE?: string; MUNICIPALITY?: string;
  ADDRESS?: string; LAT: string | number; LON: string | number; SOURCE: string;
  QUALITY_SCORE?: string | number; POPULARITY_PROXY?: string | number;
  CLUSTER_ID?: string; SEASON_PREF?: string; DESCRIPTION_SNIPPET?: string;
  VALID: string | boolean;
};

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL no está definida");

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

let provinciasDescartadas = 0;
let municipiosDescartados = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizar(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/\s+/g, " ");
}

function limpiarTexto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim().replace(/\s+/g, " ");
  if (!texto || texto.toLowerCase() === "nan" || texto.toLowerCase() === "null") return null;
  return texto;
}

function limpiarSlug(valor: string): string {
  return normalizar(valor).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function parseBool(valor: unknown): boolean {
  if (typeof valor === "boolean") return valor;
  const t = String(valor).trim().toLowerCase();
  return t === "true" || t === "1" || t === "yes";
}

function parseFloatOrNull(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const num = Number(valor);
  return Number.isFinite(num) ? num : null;
}

function normalizarProvincia(valor: string | null): string | null {
  const texto = limpiarTexto(valor);
  if (!texto) return null;
  if (texto.length > 80) { provinciasDescartadas++; return null; }
  return texto;
}

function normalizarMunicipio(valor: string | null): string | null {
  const texto = limpiarTexto(valor);
  if (!texto) return null;
  if (texto.length > 120) { municipiosDescartados++; return null; }
  return texto;
}

function normalizarSubcategoria(valor: string | null): string | null {
  if (!valor) return null;
  const key = normalizar(valor);
  if (key in SUBCAT_MAP) return SUBCAT_MAP[key];
  const sinPrefijo = key.replace(/^\d+[a-z]?_/, "");
  if (sinPrefijo in SUBCAT_MAP) return SUBCAT_MAP[sinPrefijo];
  return limpiarSlug(valor);
}

function normalizarTipo(valor: string | null): string {
  if (!valor) return "Otro";
  return TIPO_MAP[normalizar(valor)] ?? (valor.charAt(0).toUpperCase() + valor.slice(1).toLowerCase());
}

function normalizarCategoria(tipo: string | null, categoria: string | null): string {
  const key = normalizar(categoria ?? tipo ?? "");
  return CATEGORIA_MAP[key] ?? "OTRO";
}

function normalizarTemporada(valor: string | null): string {
  if (!valor) return "Todo_ano";
  const key = normalizar(valor);
  if (key.includes("verano")) return "Verano";
  if (key.includes("primavera") || key.includes("otono")) return "Primavera_otono";
  return "Todo_ano";
}

// ── Provincia de Canarias por coordenadas ─────────────────────────────────────
// Las Palmas (Gran Canaria, Lanzarote, Fuerteventura): LON > -16.0
// Santa Cruz de Tenerife (Tenerife, La Palma, La Gomera, El Hierro): LON <= -16.0
function resolverProvinciaCanarias(lat: number | null, lon: number | null): string | null {
  if (lat === null || lon === null) return null;
  if (lon > -16.0) return "Las Palmas";
  return "Santa Cruz de Tenerife";
}

function resolverCcaa(ccaaOriginal: string | null, provincia: string | null): string | null {
  const provKey = provincia ? normalizar(provincia) : null;
  if (provKey && PROVINCIA_TO_CCAA[provKey]) return PROVINCIA_TO_CCAA[provKey];
  return limpiarTexto(ccaaOriginal);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function borrarDatosPrevios() {
  console.log("🧹 Borrando datos previos y reseteando ids...");
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Mensaje", "Conversacion", "Analisis_Evento", "Item_interaccion",
      "Favoritos", "Elemento_Itinerario", "Dia_Itinerario", "Itinerario",
      "Programación_poi", "Evento", "Poi", "Categoria_poi",
      "Municipio", "Provincia", "Comunidad", "Pref_usuario", "Usuario"
    RESTART IDENTITY CASCADE;
  `);
  console.log("✅ Datos previos borrados e ids reiniciados");
}

async function main() {
  const csvPath = path.join(process.cwd(), "data", "procesado", "NATIONAL_MASTER_POIS.csv");
  if (!fs.existsSync(csvPath)) throw new Error(`No existe el CSV en: ${csvPath}`);

  console.log("📄 Leyendo NATIONAL_MASTER_POIS.csv...");
  const rawRows = parse(fs.readFileSync(csvPath, "utf-8"), {
    columns: true, skip_empty_lines: true, bom: true,
  }) as CsvRow[];
  console.log(`✅ Filas leídas: ${rawRows.length}`);

  const seen = new Set<string>();
  const rows = rawRows
    .map((r) => {
      const lat = parseFloatOrNull(r.LAT);
      const lon = parseFloatOrNull(r.LON);
      const ccaaRaw = limpiarTexto(r.CCAA);

      // Resolver provincia: CSV → si Canarias sin provincia → por coordenadas
      let provincia = normalizarProvincia(r.PROVINCE ?? null);
      if (!provincia && ccaaRaw && normalizar(ccaaRaw).includes("canarias")) {
        provincia = resolverProvinciaCanarias(lat, lon);
      }

      const ccaa = resolverCcaa(ccaaRaw, provincia);

      return {
        id_global:    limpiarTexto(r.GLOBAL_ID),
        nombre:       limpiarTexto(r.NAME),
        tipo:         normalizarTipo(limpiarTexto(r.TYPE)),
        categoria:    normalizarCategoria(limpiarTexto(r.TYPE), limpiarTexto(r.CATEGORY)),
        subcategoria: normalizarSubcategoria(limpiarTexto(r.SUBCATEGORY)),
        ccaa,
        provincia,
        municipio:    normalizarMunicipio(r.MUNICIPALITY ?? null),
        direccion:    limpiarTexto(r.ADDRESS),
        latitud:      lat,
        longitud:     lon,
        origen:       limpiarTexto(r.SOURCE),
        puntuacion:   parseFloatOrNull(r.QUALITY_SCORE),
        popularidad:  parseFloatOrNull(r.POPULARITY_PROXY),
        id_cluster:   limpiarTexto(r.CLUSTER_ID),
        temporada:    normalizarTemporada(limpiarTexto(r.SEASON_PREF)),
        descripcion:  limpiarTexto(r.DESCRIPTION_SNIPPET),
        valido:       parseBool(r.VALID),
      };
    })
    .filter((r) => r.id_global && r.nombre && r.tipo && r.categoria && r.ccaa)
    .filter((r) => {
      if (!r.id_global || seen.has(r.id_global)) return false;
      seen.add(r.id_global);
      return true;
    });

  console.log(`✅ Filas válidas: ${rows.length}`);
  console.log(`⚠️  Provincias descartadas: ${provinciasDescartadas}`);
  console.log(`⚠️  Municipios descartados: ${municipiosDescartados}`);

  const ccaasUnicas = [...new Set(rows.map((r) => r.ccaa))].sort();
  console.log(`🗺️  CCAAs detectadas (${ccaasUnicas.length}):`, ccaasUnicas);

  const sinMunicipio = rows.filter((r) => !r.municipio).length;
  console.log(`📍 POIs sin municipio antes de insertar: ${sinMunicipio}`);

  await borrarDatosPrevios();

  // ── Comunidades ───────────────────────────────────────────────────────────
  console.log("🏛️ Insertando comunidades...");
  const comunidadesUnicas = Array.from(
    new Map(rows.map((r) => [r.ccaa!, { nombre: r.ccaa!, slug: limpiarSlug(r.ccaa!) }])).values()
  );
  await prisma.comunidad.createMany({ data: comunidadesUnicas, skipDuplicates: true });
  const comunidades  = await prisma.comunidad.findMany();
  const comunidadMap = new Map(comunidades.map((c) => [c.nombre, c.id_CCAA]));
  console.log(`   ${comunidades.length} comunidades`);

  // ── Provincias ────────────────────────────────────────────────────────────
  console.log("🗺️ Insertando provincias...");
  const provinciaMapTemp = new Map<string, { nombre: string; slug: string; id_CCAA: number }>();
  for (const r of rows) {
    if (!r.provincia || !r.ccaa) continue;
    const id_CCAA = comunidadMap.get(r.ccaa);
    if (!id_CCAA) continue;
    const key = `${r.ccaa}||${r.provincia}`;
    if (!provinciaMapTemp.has(key))
      provinciaMapTemp.set(key, { nombre: r.provincia, slug: limpiarSlug(r.provincia), id_CCAA });
  }
  await prisma.provincia.createMany({ data: Array.from(provinciaMapTemp.values()), skipDuplicates: true });
  const provincias   = await prisma.provincia.findMany();
  const provinciaMap = new Map(provincias.map((p) => [`${p.id_CCAA}||${p.nombre}`, p.id_provincia]));
  console.log(`   ${provincias.length} provincias`);

  // ── Municipios ────────────────────────────────────────────────────────────
  console.log("🏙️ Insertando municipios...");
  const municipioMapTemp = new Map<string, { nombre: string; latitud: number | null; longitud: number | null; id_provincia: number }>();
  for (const r of rows) {
    if (!r.municipio || !r.provincia || !r.ccaa) continue;
    const id_CCAA = comunidadMap.get(r.ccaa);
    if (!id_CCAA) continue;
    const id_provincia = provinciaMap.get(`${id_CCAA}||${r.provincia}`);
    if (!id_provincia) continue;
    const key = `${id_provincia}||${r.municipio}`;
    if (!municipioMapTemp.has(key))
      municipioMapTemp.set(key, { nombre: r.municipio, latitud: r.latitud, longitud: r.longitud, id_provincia });
  }
  await prisma.municipio.createMany({ data: Array.from(municipioMapTemp.values()), skipDuplicates: true });
  const municipios   = await prisma.municipio.findMany();
  const municipioMap = new Map(municipios.map((m) => [`${m.id_provincia}||${m.nombre}`, m.id_municipio]));
  console.log(`   ${municipios.length} municipios`);

  // ── Categorías ────────────────────────────────────────────────────────────
  console.log("🏷️ Insertando categorías...");
  const categoriasUnicas = Array.from(
    new Map(rows.map((r) => [r.categoria, { nombre: r.categoria, slug: limpiarSlug(r.categoria) }])).values()
  );
  await prisma.categoria_poi.createMany({ data: categoriasUnicas, skipDuplicates: true });
  const categorias   = await prisma.categoria_poi.findMany();
  const categoriaMap = new Map(categorias.map((c) => [c.nombre, c.id_categoria_poi]));
  console.log(`   ${categorias.length} categorías`);

  // ── POIs ──────────────────────────────────────────────────────────────────
  console.log("📍 Preparando POIs...");
  const ahora = new Date();
  const pois = rows.map((r) => {
    let id_municipio: number | null = null;
    if (r.municipio && r.provincia && r.ccaa) {
      const id_CCAA = comunidadMap.get(r.ccaa);
      if (id_CCAA) {
        const id_provincia = provinciaMap.get(`${id_CCAA}||${r.provincia}`);
        if (id_provincia) id_municipio = municipioMap.get(`${id_provincia}||${r.municipio}`) ?? null;
      }
    }
    const id_categoria_poi = categoriaMap.get(r.categoria);
    if (!id_categoria_poi) throw new Error(`No se encontró categoría para: ${r.categoria}`);
    return {
      id_global:       r.id_global!,
      nombre:          r.nombre!,
      tipo:            r.tipo,
      subcategoria:    r.subcategoria,
      direccion:       r.direccion,
      latitud:         r.latitud,
      longitud:        r.longitud,
      descripcion:     r.descripcion,
      temporada:       r.temporada,
      puntuacion:      r.puntuacion,
      popularidad:     r.popularidad,
      id_cluster:      r.id_cluster,
      origen:          r.origen,
      valido:          r.valido,
      creado:          ahora,
      actualizado:     ahora,
      id_municipio,
      id_categoria_poi,
    };
  });

  console.log(`📍 Insertando ${pois.length} POIs en lotes de 1000...`);
  const bloques = chunkArray(pois, 1000);
  for (let i = 0; i < bloques.length; i++) {
    await prisma.poi.createMany({ data: bloques[i], skipDuplicates: true });
    console.log(`✅ Lote ${i + 1}/${bloques.length} insertado`);
  }

  const [totalComunidad, totalProvincia, totalMunicipio, totalCategoria,
         totalPoi, totalPoisSinMunicipio, totalUsuario, totalFavoritos, totalItinerario] =
    await Promise.all([
      prisma.comunidad.count(), prisma.provincia.count(), prisma.municipio.count(),
      prisma.categoria_poi.count(), prisma.poi.count(),
      prisma.poi.count({ where: { id_municipio: null } }),
      prisma.usuario.count(), prisma.favoritos.count(), prisma.itinerario.count(),
    ]);

  console.log("🎉 Importación completada");
  console.log({
    Comunidad: totalComunidad, Provincia: totalProvincia, Municipio: totalMunicipio,
    Categoria_poi: totalCategoria, Poi: totalPoi, Poi_sin_municipio: totalPoisSinMunicipio,
    Usuario: totalUsuario, Favoritos: totalFavoritos, Itinerario: totalItinerario,
  });
}

main()
  .catch((e) => { console.error("❌ Error importando CSV real:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
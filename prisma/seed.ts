import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL no está definida en el archivo .env");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🔄 Limpiando datos de prueba previos...");

  await prisma.mensaje.deleteMany();
  await prisma.conversacion.deleteMany();
  await prisma.analisis_Evento.deleteMany();
  await prisma.item_interaccion.deleteMany();
  await prisma.favoritos.deleteMany();
  await prisma.elemento_Itinerario.deleteMany();
  await prisma.dia_Itinerario.deleteMany();
  await prisma.itinerario.deleteMany();
  await prisma.programacion_poi.deleteMany();
  await prisma.evento.deleteMany();
  await prisma.poi.deleteMany();
  await prisma.categoria_poi.deleteMany();
  await prisma.municipio.deleteMany();
  await prisma.provincia.deleteMany();
  await prisma.comunidad.deleteMany();
  await prisma.pref_usuario.deleteMany();
  await prisma.usuario.deleteMany();

  console.log("✅ Base limpia");

  const ahora = new Date();

  console.log("🔄 Insertando Usuario...");
  const usuario = await prisma.usuario.create({
    data: {
      nombre: "Borja",
      email: "borja@test.com",
      contrasena: "123456",
      rol: "user",
      creado: ahora,
      actualizado: ahora,
    },
  });

  console.log("🔄 Insertando Pref_usuario...");
  await prisma.pref_usuario.create({
    data: {
      presupuesto: 2,
      modo_transporte: "coche",
      accesibilidad: "media",
      con_ninos: false,
      estilo_viaje: "cultural",
      intereses: "museos,patrimonio,naturaleza",
      id_usuario: usuario.id_usuario,
    },
  });

  console.log("🔄 Insertando Comunidad...");
  const comunidad = await prisma.comunidad.create({
    data: {
      nombre: "Andalucia",
      slug: "andalucia",
    },
  });

  console.log("🔄 Insertando Provincia...");
  const provincia = await prisma.provincia.create({
    data: {
      nombre: "Granada",
      slug: "granada",
      id_CCAA: comunidad.id_CCAA,
    },
  });

  console.log("🔄 Insertando Municipio...");
  const municipio = await prisma.municipio.create({
    data: {
      nombre: "Granada",
      latitud: 37.1773,
      longitud: -3.5986,
      id_provincia: provincia.id_provincia,
    },
  });

  console.log("🔄 Insertando Categoria_poi...");
  const categoriaMonumento = await prisma.categoria_poi.create({
    data: {
      nombre: "Monumento",
      slug: "monumento",
    },
  });

  const categoriaMuseo = await prisma.categoria_poi.create({
    data: {
      nombre: "Museo",
      slug: "museo",
    },
  });

  await prisma.categoria_poi.create({
    data: {
      nombre: "Naturaleza",
      slug: "naturaleza",
    },
  });

  console.log("🔄 Insertando Poi...");
  const poi1 = await prisma.poi.create({
    data: {
      nombre: "Alhambra",
      tipo: "Monumento",
      subcategoria: "Patrimonio",
      direccion: "C. Real de la Alhambra, Granada",
      latitud: 37.1761,
      longitud: -3.5881,
      descripcion: "Conjunto monumental histórico de Granada",
      temporada: "Todo el año",
      puntuacion: 9.8,
      popularidad: 9.9,
      id_cluster: 1,
      origen: "Dataset",
      valido: true,
      creado: ahora,
      actualizado: ahora,
      id_municipio: municipio.id_municipio,
      id_categoria_poi: categoriaMonumento.id_categoria_poi,
      id_global: "POI_GRANADA_0001",
    },
  });

  const poi2 = await prisma.poi.create({
    data: {
      nombre: "Catedral de Granada",
      tipo: "Monumento",
      subcategoria: "Religioso",
      direccion: "Calle Gran Vía, Granada",
      latitud: 37.1765,
      longitud: -3.5995,
      descripcion: "Catedral renacentista en el centro de Granada",
      temporada: "Todo el año",
      puntuacion: 9.1,
      popularidad: 8.7,
      id_cluster: 1,
      origen: "Dataset",
      valido: true,
      creado: ahora,
      actualizado: ahora,
      id_municipio: municipio.id_municipio,
      id_categoria_poi: categoriaMonumento.id_categoria_poi,
      id_global: "POI_GRANADA_0002",
    },
  });

  const poi3 = await prisma.poi.create({
    data: {
      nombre: "Parque de las Ciencias",
      tipo: "Museo",
      subcategoria: "Ciencia",
      direccion: "Av. de la Ciencia, Granada",
      latitud: 37.1638,
      longitud: -3.6063,
      descripcion: "Museo interactivo de ciencia",
      temporada: "Todo el año",
      puntuacion: 8.9,
      popularidad: 8.4,
      id_cluster: 2,
      origen: "Dataset",
      valido: true,
      creado: ahora,
      actualizado: ahora,
      id_municipio: municipio.id_municipio,
      id_categoria_poi: categoriaMuseo.id_categoria_poi,
      id_global: "POI_GRANADA_0003",
    },
  });

  console.log("🔄 Insertando Programación_poi...");
  await prisma.programacion_poi.createMany({
    data: [
      {
        dia_semana: 1,
        inicio: "09:00",
        fin: "18:00",
        cerrado: false,
        id_poi: poi1.id_poi,
      },
      {
        dia_semana: 2,
        inicio: "10:00",
        fin: "19:00",
        cerrado: false,
        id_poi: poi3.id_poi,
      },
    ],
  });

  console.log("🔄 Insertando Evento...");
  await prisma.evento.create({
    data: {
      nombre: "Festival Cultural de Granada",
      descripcion: "Evento cultural de prueba",
      inicio: new Date("2026-05-10T18:00:00"),
      fin: new Date("2026-05-10T22:00:00"),
      latitud: 37.177,
      longitud: -3.598,
      id_municipio: municipio.id_municipio,
      origen: "Manual",
    },
  });

  console.log("🔄 Insertando Conversacion...");
  const conversacion = await prisma.conversacion.create({
    data: {
      titulo: "Plan para visitar Granada",
      creado: ahora,
      id_usuario: usuario.id_usuario,
    },
  });

  console.log("🔄 Insertando Mensaje...");
  await prisma.mensaje.createMany({
    data: [
      {
        rol: "user",
        contenido: "Quiero visitar Granada en dos días",
        creado: ahora,
        id_conversacion: conversacion.id_conversacion,
      },
      {
        rol: "assistant",
        contenido: "Te propongo un itinerario con Alhambra, Catedral y Parque de las Ciencias",
        creado: ahora,
        id_conversacion: conversacion.id_conversacion,
      },
    ],
  });

  console.log("🔄 Insertando Itinerario...");
  const itinerario = await prisma.itinerario.create({
    data: {
      titulo: "Escapada Granada 2 días",
      destino: "Granada",
      inicio: new Date("2026-05-10"),
      fin: new Date("2026-05-11"),
      presupuesto: 2,
      transporte: "coche",
      accesibilidad: "media",
      estado: "borrador",
      creado: ahora,
      actualizado: ahora,
      id_usuario: usuario.id_usuario,
    },
  });

  console.log("🔄 Insertando Dia_Itinerario...");
  const dia1 = await prisma.dia_Itinerario.create({
    data: {
      fecha: new Date("2026-05-10"),
      minutos: 480,
      notas: "Día centrado en el casco histórico",
      id_itinerario: itinerario.id_itinerario,
    },
  });

  const dia2 = await prisma.dia_Itinerario.create({
    data: {
      fecha: new Date("2026-05-11"),
      minutos: 420,
      notas: "Día más relajado con museo",
      id_itinerario: itinerario.id_itinerario,
    },
  });

  console.log("🔄 Insertando Elemento_Itinerario...");
  await prisma.elemento_Itinerario.createMany({
    data: [
      {
        inicio: new Date("2026-05-10T09:00:00"),
        fin: new Date("2026-05-10T12:00:00"),
        orden: 1,
        transporte: "a pie",
        tiempo_transporte: 15,
        id_dia_itinerario: dia1.id_dia_itinerario,
        id_poi: poi1.id_poi,
      },
      {
        inicio: new Date("2026-05-10T13:00:00"),
        fin: new Date("2026-05-10T14:30:00"),
        orden: 2,
        transporte: "a pie",
        tiempo_transporte: 10,
        id_dia_itinerario: dia1.id_dia_itinerario,
        id_poi: poi2.id_poi,
      },
      {
        inicio: new Date("2026-05-11T10:00:00"),
        fin: new Date("2026-05-11T13:00:00"),
        orden: 1,
        transporte: "coche",
        tiempo_transporte: 20,
        id_dia_itinerario: dia2.id_dia_itinerario,
        id_poi: poi3.id_poi,
      },
    ],
  });

  console.log("🔄 Insertando Favoritos...");
  await prisma.favoritos.create({
    data: {
      creado: ahora,
      id_usuario: usuario.id_usuario,
      id_poi: poi1.id_poi,
    },
  });

  console.log("🔄 Insertando Item_interaccion...");
  await prisma.item_interaccion.createMany({
    data: [
      {
        metadata: "click detalle poi",
        creado: ahora,
        tipo_accion: "ver_detalle",
        id_usuario: usuario.id_usuario,
        id_poi: poi1.id_poi,
      },
      {
        metadata: "anadir favorito",
        creado: ahora,
        tipo_accion: "favorito",
        id_usuario: usuario.id_usuario,
        id_poi: poi1.id_poi,
      },
    ],
  });

  console.log("🔄 Insertando Analisis_Evento...");
  await prisma.analisis_Evento.createMany({
    data: [
      {
        nombre_evento: "consulta_asistente",
        tipo_entidad: "Conversacion",
        id_entidad: conversacion.id_conversacion,
        metadata: "planificacion granada",
        creado: ahora,
        id_usuario: usuario.id_usuario,
      },
      {
        nombre_evento: "creacion_itinerario",
        tipo_entidad: "Itinerario",
        id_entidad: itinerario.id_itinerario,
        metadata: "itinerario 2 dias",
        creado: ahora,
        id_usuario: usuario.id_usuario,
      },
    ],
  });

  console.log("✅ Datos de prueba insertados correctamente");
}

main()
  .catch((e) => {
    console.error("❌ Error en seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
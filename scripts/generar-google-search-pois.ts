import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildGoogleSearchUrl } from "../src/utils/googleSearchUrl";

const prisma = new PrismaClient();

async function main() {
  console.log("Cargando POIs...");
  const pois = await prisma.poi.findMany({
    include: {
      municipio: {
        include: {
          provincia: {
            include: { comunidad: true },
          },
        },
      },
    },
  });

  const total = pois.length;
  const BATCH_SIZE = 100; // Procesar 100 a la vez
  let count = 0;

  console.log(`Iniciando actualización de ${total} filas...`);

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = pois.slice(i, i + BATCH_SIZE);
    
    await Promise.all(
      batch.map((poi) => {
        const url = buildGoogleSearchUrl({
          name: poi.nombre,
          municipality: poi.municipio?.nombre,
          province: poi.municipio?.provincia?.nombre,
          ccaa: poi.municipio?.provincia?.comunidad?.nombre,
        });

        return prisma.poi.update({
          where: { id_poi: poi.id_poi },
          data: { google_search_url: url },
        });
      })
    );

    count += batch.length;
    console.log(`Progreso: ${count}/${total} (${((count / total) * 100).toFixed(2)}%)`);
  }

  console.log("¡Actualización completada!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
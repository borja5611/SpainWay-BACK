/*
  Warnings:

  - You are about to alter the column `latitud` on the `Poi` table. The data in that column could be lost. The data in that column will be cast from `Decimal(10,7)` to `DoublePrecision`.
  - You are about to alter the column `longitud` on the `Poi` table. The data in that column could be lost. The data in that column will be cast from `Decimal(10,7)` to `DoublePrecision`.
  - You are about to alter the column `puntuacion` on the `Poi` table. The data in that column could be lost. The data in that column will be cast from `Decimal(10,2)` to `DoublePrecision`.
  - You are about to alter the column `popularidad` on the `Poi` table. The data in that column could be lost. The data in that column will be cast from `Decimal(10,2)` to `DoublePrecision`.

*/
-- DropForeignKey
ALTER TABLE "Poi" DROP CONSTRAINT "Poi_id_municipio_fkey";

-- AlterTable
ALTER TABLE "Poi" ALTER COLUMN "latitud" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "longitud" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "puntuacion" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "popularidad" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "id_cluster" SET DATA TYPE VARCHAR(150),
ALTER COLUMN "origen" SET DATA TYPE VARCHAR(150),
ALTER COLUMN "id_municipio" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Poi" ADD CONSTRAINT "Poi_id_municipio_fkey" FOREIGN KEY ("id_municipio") REFERENCES "Municipio"("id_municipio") ON DELETE SET NULL ON UPDATE CASCADE;

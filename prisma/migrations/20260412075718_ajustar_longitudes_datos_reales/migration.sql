/*
  Warnings:

  - You are about to alter the column `nombre` on the `Categoria_poi` table. The data in that column could be lost. The data in that column will be cast from `VarChar(100)` to `VarChar(50)`.
  - You are about to alter the column `slug` on the `Categoria_poi` table. The data in that column could be lost. The data in that column will be cast from `VarChar(100)` to `VarChar(80)`.
  - You are about to alter the column `nombre` on the `Comunidad` table. The data in that column could be lost. The data in that column will be cast from `VarChar(100)` to `VarChar(50)`.
  - You are about to alter the column `slug` on the `Comunidad` table. The data in that column could be lost. The data in that column will be cast from `VarChar(100)` to `VarChar(80)`.
  - You are about to alter the column `latitud` on the `Municipio` table. The data in that column could be lost. The data in that column will be cast from `Decimal(10,7)` to `DoublePrecision`.
  - You are about to alter the column `longitud` on the `Municipio` table. The data in that column could be lost. The data in that column will be cast from `Decimal(10,7)` to `DoublePrecision`.
  - You are about to alter the column `tipo` on the `Poi` table. The data in that column could be lost. The data in that column will be cast from `VarChar(100)` to `VarChar(80)`.
  - You are about to alter the column `temporada` on the `Poi` table. The data in that column could be lost. The data in that column will be cast from `VarChar(100)` to `VarChar(80)`.
  - You are about to alter the column `id_cluster` on the `Poi` table. The data in that column could be lost. The data in that column will be cast from `VarChar(150)` to `VarChar(50)`.
  - You are about to alter the column `origen` on the `Poi` table. The data in that column could be lost. The data in that column will be cast from `VarChar(150)` to `VarChar(80)`.
  - You are about to alter the column `nombre` on the `Provincia` table. The data in that column could be lost. The data in that column will be cast from `VarChar(100)` to `VarChar(80)`.
  - You are about to alter the column `slug` on the `Provincia` table. The data in that column could be lost. The data in that column will be cast from `VarChar(100)` to `VarChar(80)`.

*/
-- AlterTable
ALTER TABLE "Categoria_poi" ALTER COLUMN "nombre" SET DATA TYPE VARCHAR(50),
ALTER COLUMN "slug" SET DATA TYPE VARCHAR(80);

-- AlterTable
ALTER TABLE "Comunidad" ALTER COLUMN "nombre" SET DATA TYPE VARCHAR(50),
ALTER COLUMN "slug" SET DATA TYPE VARCHAR(80);

-- AlterTable
ALTER TABLE "Municipio" ALTER COLUMN "nombre" SET DATA TYPE VARCHAR(300),
ALTER COLUMN "latitud" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "longitud" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Poi" ALTER COLUMN "nombre" SET DATA TYPE VARCHAR(400),
ALTER COLUMN "tipo" SET DATA TYPE VARCHAR(80),
ALTER COLUMN "subcategoria" SET DATA TYPE VARCHAR(150),
ALTER COLUMN "direccion" SET DATA TYPE VARCHAR(300),
ALTER COLUMN "descripcion" SET DATA TYPE VARCHAR(1500),
ALTER COLUMN "temporada" SET DATA TYPE VARCHAR(80),
ALTER COLUMN "id_cluster" SET DATA TYPE VARCHAR(50),
ALTER COLUMN "origen" SET DATA TYPE VARCHAR(80);

-- AlterTable
ALTER TABLE "Provincia" ALTER COLUMN "nombre" SET DATA TYPE VARCHAR(80),
ALTER COLUMN "slug" SET DATA TYPE VARCHAR(80);

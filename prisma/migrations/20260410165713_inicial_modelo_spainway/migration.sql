-- CreateTable
CREATE TABLE "Usuario" (
    "id_usuario" SERIAL NOT NULL,
    "nombre" VARCHAR(20) NOT NULL,
    "email" VARCHAR(20) NOT NULL,
    "contraseña" VARCHAR(20) NOT NULL,
    "rol" VARCHAR(20) NOT NULL,
    "creado" TIMESTAMP(3) NOT NULL,
    "actualizado" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id_usuario")
);

-- CreateTable
CREATE TABLE "Pref_usuario" (
    "id_usuario_preference" SERIAL NOT NULL,
    "presupuesto" INTEGER,
    "modo_transporte" VARCHAR(20),
    "accesibilidad" VARCHAR(20),
    "con_niños" BOOLEAN,
    "estilo_viaje" VARCHAR(20),
    "intereses" VARCHAR(20),
    "id_usuario" INTEGER NOT NULL,

    CONSTRAINT "Pref_usuario_pkey" PRIMARY KEY ("id_usuario_preference")
);

-- CreateTable
CREATE TABLE "Comunidad" (
    "id_CCAA" SERIAL NOT NULL,
    "nombre" VARCHAR(20) NOT NULL,
    "slug" VARCHAR(50) NOT NULL,

    CONSTRAINT "Comunidad_pkey" PRIMARY KEY ("id_CCAA")
);

-- CreateTable
CREATE TABLE "Provincia" (
    "id_provincia" SERIAL NOT NULL,
    "nombre" VARCHAR(20) NOT NULL,
    "slug" VARCHAR(50) NOT NULL,
    "id_CCAA" INTEGER NOT NULL,

    CONSTRAINT "Provincia_pkey" PRIMARY KEY ("id_provincia")
);

-- CreateTable
CREATE TABLE "Municipio" (
    "id_municipio" SERIAL NOT NULL,
    "nombre" VARCHAR(20) NOT NULL,
    "latitud" DECIMAL(10,7),
    "longitud" DECIMAL(10,7),
    "id_provincia" INTEGER NOT NULL,

    CONSTRAINT "Municipio_pkey" PRIMARY KEY ("id_municipio")
);

-- CreateTable
CREATE TABLE "Categoria_poi" (
    "id_categoria_poi" SERIAL NOT NULL,
    "nombre" VARCHAR(20) NOT NULL,
    "slug" VARCHAR(50) NOT NULL,

    CONSTRAINT "Categoria_poi_pkey" PRIMARY KEY ("id_categoria_poi")
);

-- CreateTable
CREATE TABLE "Poi" (
    "id_poi" SERIAL NOT NULL,
    "nombre" VARCHAR(20) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "subcategoria" VARCHAR(20),
    "direccion" VARCHAR(100),
    "latitud" DECIMAL(10,7),
    "longitud" DECIMAL(10,7),
    "descripcion" VARCHAR(255),
    "temporada" VARCHAR(20),
    "puntuacion" DECIMAL(10,2),
    "popularidad" DECIMAL(10,2),
    "id_cluster" INTEGER,
    "origen" VARCHAR(20),
    "valido" BOOLEAN,
    "creado" TIMESTAMP(3),
    "actualizado" TIMESTAMP(3),
    "id_municipio" INTEGER NOT NULL,
    "id_categoria_poi" INTEGER NOT NULL,
    "id_global" VARCHAR(100) NOT NULL,

    CONSTRAINT "Poi_pkey" PRIMARY KEY ("id_poi")
);

-- CreateTable
CREATE TABLE "Programación_poi" (
    "id_programación" SERIAL NOT NULL,
    "dia_semana" INTEGER NOT NULL,
    "inicio" VARCHAR(10),
    "fin" VARCHAR(10),
    "cerrado" BOOLEAN,
    "id_poi" INTEGER NOT NULL,

    CONSTRAINT "Programación_poi_pkey" PRIMARY KEY ("id_programación")
);

-- CreateTable
CREATE TABLE "Evento" (
    "id_evento" SERIAL NOT NULL,
    "nombre" VARCHAR(20) NOT NULL,
    "descripcion" VARCHAR(255),
    "inicio" TIMESTAMP(3),
    "fin" TIMESTAMP(3),
    "latitud" DECIMAL(10,7),
    "longitud" DECIMAL(10,7),
    "id_municipio" INTEGER NOT NULL,
    "origen" VARCHAR(20),

    CONSTRAINT "Evento_pkey" PRIMARY KEY ("id_evento")
);

-- CreateTable
CREATE TABLE "Favoritos" (
    "id_favoritos" SERIAL NOT NULL,
    "creado" TIMESTAMP(3),
    "id_usuario" INTEGER NOT NULL,
    "id_poi" INTEGER NOT NULL,

    CONSTRAINT "Favoritos_pkey" PRIMARY KEY ("id_favoritos")
);

-- CreateTable
CREATE TABLE "Item_interaccion" (
    "id_interaccion" SERIAL NOT NULL,
    "metadata" VARCHAR(255),
    "creado" TIMESTAMP(3),
    "tipo_accion" VARCHAR(20),
    "id_usuario" INTEGER NOT NULL,
    "id_poi" INTEGER NOT NULL,

    CONSTRAINT "Item_interaccion_pkey" PRIMARY KEY ("id_interaccion")
);

-- CreateTable
CREATE TABLE "Analisis_Evento" (
    "id_analisis_evento" SERIAL NOT NULL,
    "nombre_evento" VARCHAR(50),
    "tipo_entidad" VARCHAR(50),
    "id_entidad" INTEGER,
    "metadata" VARCHAR(255),
    "creado" TIMESTAMP(3),
    "id_usuario" INTEGER NOT NULL,

    CONSTRAINT "Analisis_Evento_pkey" PRIMARY KEY ("id_analisis_evento")
);

-- CreateTable
CREATE TABLE "Conversacion" (
    "id_conversacion" SERIAL NOT NULL,
    "titulo" VARCHAR(100),
    "creado" TIMESTAMP(3),
    "id_usuario" INTEGER NOT NULL,

    CONSTRAINT "Conversacion_pkey" PRIMARY KEY ("id_conversacion")
);

-- CreateTable
CREATE TABLE "Mensaje" (
    "id_mensaje" SERIAL NOT NULL,
    "rol" VARCHAR(20),
    "contenido" VARCHAR(255),
    "creado" TIMESTAMP(3),
    "id_conversacion" INTEGER NOT NULL,

    CONSTRAINT "Mensaje_pkey" PRIMARY KEY ("id_mensaje")
);

-- CreateTable
CREATE TABLE "Itinerario" (
    "id_itinerario" SERIAL NOT NULL,
    "titulo" VARCHAR(100),
    "destino" VARCHAR(100),
    "inicio" TIMESTAMP(3),
    "fin" TIMESTAMP(3),
    "presupuesto" INTEGER,
    "transporte" VARCHAR(20),
    "accesibilidad" VARCHAR(20),
    "estado" VARCHAR(20),
    "creado" TIMESTAMP(3),
    "actualizado" TIMESTAMP(3),
    "id_usuario" INTEGER NOT NULL,

    CONSTRAINT "Itinerario_pkey" PRIMARY KEY ("id_itinerario")
);

-- CreateTable
CREATE TABLE "Dia_Itinerario" (
    "id_dia_itinerario" SERIAL NOT NULL,
    "fecha" TIMESTAMP(3),
    "minutos" INTEGER,
    "notas" VARCHAR(255),
    "id_itinerario" INTEGER NOT NULL,

    CONSTRAINT "Dia_Itinerario_pkey" PRIMARY KEY ("id_dia_itinerario")
);

-- CreateTable
CREATE TABLE "Elemento_Itinerario" (
    "id_elemento_itinerario" SERIAL NOT NULL,
    "inicio" TIMESTAMP(3),
    "fin" TIMESTAMP(3),
    "orden" INTEGER,
    "transporte" VARCHAR(20),
    "tiempo_transporte" INTEGER,
    "id_dia_itinerario" INTEGER NOT NULL,
    "id_poi" INTEGER NOT NULL,

    CONSTRAINT "Elemento_Itinerario_pkey" PRIMARY KEY ("id_elemento_itinerario")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Pref_usuario_id_usuario_key" ON "Pref_usuario"("id_usuario");

-- CreateIndex
CREATE UNIQUE INDEX "Comunidad_nombre_key" ON "Comunidad"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Comunidad_slug_key" ON "Comunidad"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Provincia_id_CCAA_nombre_key" ON "Provincia"("id_CCAA", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Municipio_id_provincia_nombre_key" ON "Municipio"("id_provincia", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_poi_nombre_key" ON "Categoria_poi"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_poi_slug_key" ON "Categoria_poi"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Poi_id_global_key" ON "Poi"("id_global");

-- CreateIndex
CREATE UNIQUE INDEX "Favoritos_id_usuario_id_poi_key" ON "Favoritos"("id_usuario", "id_poi");

-- AddForeignKey
ALTER TABLE "Pref_usuario" ADD CONSTRAINT "Pref_usuario_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "Usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Provincia" ADD CONSTRAINT "Provincia_id_CCAA_fkey" FOREIGN KEY ("id_CCAA") REFERENCES "Comunidad"("id_CCAA") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Municipio" ADD CONSTRAINT "Municipio_id_provincia_fkey" FOREIGN KEY ("id_provincia") REFERENCES "Provincia"("id_provincia") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poi" ADD CONSTRAINT "Poi_id_municipio_fkey" FOREIGN KEY ("id_municipio") REFERENCES "Municipio"("id_municipio") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poi" ADD CONSTRAINT "Poi_id_categoria_poi_fkey" FOREIGN KEY ("id_categoria_poi") REFERENCES "Categoria_poi"("id_categoria_poi") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Programación_poi" ADD CONSTRAINT "Programación_poi_id_poi_fkey" FOREIGN KEY ("id_poi") REFERENCES "Poi"("id_poi") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_id_municipio_fkey" FOREIGN KEY ("id_municipio") REFERENCES "Municipio"("id_municipio") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favoritos" ADD CONSTRAINT "Favoritos_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "Usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favoritos" ADD CONSTRAINT "Favoritos_id_poi_fkey" FOREIGN KEY ("id_poi") REFERENCES "Poi"("id_poi") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item_interaccion" ADD CONSTRAINT "Item_interaccion_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "Usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item_interaccion" ADD CONSTRAINT "Item_interaccion_id_poi_fkey" FOREIGN KEY ("id_poi") REFERENCES "Poi"("id_poi") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analisis_Evento" ADD CONSTRAINT "Analisis_Evento_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "Usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversacion" ADD CONSTRAINT "Conversacion_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "Usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mensaje" ADD CONSTRAINT "Mensaje_id_conversacion_fkey" FOREIGN KEY ("id_conversacion") REFERENCES "Conversacion"("id_conversacion") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Itinerario" ADD CONSTRAINT "Itinerario_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "Usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dia_Itinerario" ADD CONSTRAINT "Dia_Itinerario_id_itinerario_fkey" FOREIGN KEY ("id_itinerario") REFERENCES "Itinerario"("id_itinerario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Elemento_Itinerario" ADD CONSTRAINT "Elemento_Itinerario_id_dia_itinerario_fkey" FOREIGN KEY ("id_dia_itinerario") REFERENCES "Dia_Itinerario"("id_dia_itinerario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Elemento_Itinerario" ADD CONSTRAINT "Elemento_Itinerario_id_poi_fkey" FOREIGN KEY ("id_poi") REFERENCES "Poi"("id_poi") ON DELETE CASCADE ON UPDATE CASCADE;

# SpainWay-BACK

Backend principal de SpainWay, plataforma de turismo inteligente para España basada en datos abiertos, asistente conversacional e itinerarios personalizados.

Este repositorio contiene la API REST encargada de gestionar la lógica de negocio, la autenticación, los usuarios, las preferencias, los puntos de interés, los itinerarios, los eventos, los favoritos, las conversaciones y la conexión con el módulo de inteligencia artificial.

## Función dentro de SpainWay

El backend actúa como núcleo funcional de la plataforma. Recibe las peticiones del frontend, valida la información, consulta la base de datos, coordina los módulos internos y devuelve respuestas estructuradas.

También se comunica con el servicio de inteligencia artificial para apoyar la recomendación de puntos de interés y la generación de itinerarios personalizados.

## Tecnologías utilizadas

- Node.js
- TypeScript
- Fastify
- Prisma ORM
- PostgreSQL
- JWT
- Bcrypt
- Nodemailer
- Axios
- csv-parse
- dotenv

## Estructura general

```text
SpainWay-BACK/
├── prisma/               # Esquema Prisma, migraciones, seeds e importadores
├── scripts/              # Scripts auxiliares de tratamiento/enriquecimiento de datos
├── src/                  # Código fuente del backend
│   ├── generated/         # Cliente Prisma generado
│   ├── lib/               # Utilidades comunes
│   └── modules/           # Módulos funcionales del sistema
├── .env.example          # Variables de entorno de ejemplo
├── Endpoints.txt         # Documento resumen de endpoints
├── package.json          # Dependencias y scripts
└── tsconfig.json         # Configuración TypeScript
```

## Módulos principales

El backend se organiza en módulos funcionales. Entre los principales se encuentran:

- Autenticación
- Recuperación de contraseña
- Usuarios
- Preferencias
- Puntos de interés
- Itinerarios
- Eventos
- Favoritos
- Recomendaciones
- Restauración
- Conversaciones
- Analítica

Esta separación facilita el mantenimiento del sistema y permite ampliar la plataforma en futuras versiones.

## Variables de entorno

Crear un archivo `.env` a partir de `.env.example`.

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=
DIRECT_URL=
FRONTEND_URL=http://localhost:5173
RECOMMENDER_API_URL=http://127.0.0.1:8001
JWT_SECRET=
PASSWORD_RESET_SECRET=
PASSWORD_RESET_MINUTES=10

FSQ_API_KEY=
GEOAPIFY_API_KEY=
TICKETMASTER_API_KEY=
PREDICTHQ_API_KEY=
SERPAPI_API_KEY=

PREDICTHQ_RADIUS_KM=25
EVENTS_LIVE_ENABLED=true
EVENTS_LIVE_TIMEOUT_MS=7000
EVENTS_LIVE_MAX_RESULTS=20

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
```

Descripción de variables principales:

- `PORT`: puerto de ejecución del backend.
- `DATABASE_URL`: URL de conexión a PostgreSQL.
- `DIRECT_URL`: URL directa de conexión a la base de datos, usada por Prisma en determinados entornos.
- `FRONTEND_URL`: URL del frontend autorizado.
- `RECOMMENDER_API_URL`: URL del servicio de IA/recomendación.
- `JWT_SECRET`: secreto para firmar tokens JWT.
- `PASSWORD_RESET_SECRET`: secreto para recuperación de contraseña.
- `SMTP_*`: configuración de correo para recuperación de contraseña.
- `FSQ_API_KEY`, `GEOAPIFY_API_KEY`, `TICKETMASTER_API_KEY`, `PREDICTHQ_API_KEY`, `SERPAPI_API_KEY`: claves opcionales para servicios externos.

## Instalación

```bash
npm install
```

## Generar cliente Prisma

```bash
npm run prisma:generate
```

O directamente:

```bash
npx prisma generate
```

## Ejecutar migraciones

```bash
npm run prisma:migrate
```

O directamente:

```bash
npx prisma migrate dev
```

## Cargar datos iniciales

El proyecto incluye scripts de seed e importación dentro de la carpeta `prisma`.

```bash
npx prisma db seed
```

También existen scripts específicos para importar o enriquecer puntos de interés reales.

## Ejecución en local

```bash
npm run dev
```

Por defecto, el backend se ejecuta en:

```text
http://localhost:3000
```

## Compilación para producción

```bash
npm run build
```

## Ejecución en producción

```bash
npm start
```

## Endpoints

El archivo `Endpoints.txt` contiene un resumen de rutas disponibles en la API.

De forma general, el backend expone endpoints relacionados con:

- Registro e inicio de sesión
- Gestión de usuarios
- Preferencias
- Puntos de interés
- Itinerarios
- Recomendaciones
- Eventos
- Favoritos
- Conversaciones
- Analítica

## Relación con otros repositorios

Este repositorio se comunica con:

- `SpainWay-FRONT`: aplicación principal utilizada por el usuario.
- `Spainway-IA`: servicio FastAPI encargado de recomendaciones, selección de POIs y apoyo a la generación de itinerarios.
- `SpainWay-Web`: página web de presentación del proyecto.

## Flujo de funcionamiento

1. El frontend envía una petición al backend.
2. El backend valida la información recibida.
3. Si es necesario, consulta PostgreSQL mediante Prisma.
4. Si la petición requiere recomendación, consulta el servicio IA mediante `RECOMMENDER_API_URL`.
5. El backend procesa la respuesta y devuelve datos estructurados al frontend.
6. El frontend muestra el resultado al usuario.

## Estado del prototipo

El backend se encuentra en estado de prototipo funcional para el Trabajo Fin de Grado. Implementa la estructura principal necesaria para demostrar la arquitectura de SpainWay, la gestión de usuarios, la persistencia de datos, la consulta de recursos turísticos y la coordinación con el sistema de recomendación.

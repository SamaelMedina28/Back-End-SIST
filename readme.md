## Express + Prisma + TypeScript Boilerplate

Un **Starter Template** (Boilerplate) backend moderno, escalable y listo para producción, construido con **Express.js**, **TypeScript**, **Prisma ORM** y **PostgreSQL**.

Incluye autenticación segura basada en **JWT + Cookies HttpOnly**, validaciones con **Zod**, manejo de **CORS** y **Vane CLI**, una herramienta de comandos rápida para autogenerar módulos, controladores, servicios y middlewares al estilo `php artisan`.

## Tecnologías y Librerías

*   **Entorno / Lenguaje:** Node.js, TypeScript
*   **Framework:** Express.js
*   **ORM / Base de datos:** Prisma ORM, PostgreSQL
*   **Gestor de paquetes / Runner:** pnpm, `tsx`
*   **Autenticación:** JSON Web Tokens (`jsonwebtoken`), `bcryptjs`, `cookie-parser`
*   **Seguridad & Red:** `cors` (Soporte con credentials/cookies)
*   **Validación:** Zod

## Estructura del Proyecto

```plaintext
.
├── cli/                        # Herramienta CLI personalizada (Vane)
│   └── vane.ts
├── prisma/                     # Esquema y migraciones de la base de datos
│   ├── schema.prisma
│   └── migrations/
├── lib/                         # Funciones y utilidades
│   ├── prisma.ts                # Inicializador de prisma
├── src/
│   ├── config/                 # Configuraciones globales
│   ├── middlewares/            # Middlewares reutilizables (Auth, Validate, etc.)
│   ├── routes/                 # Centralizador de rutas de la API
│   │   └── index.ts
│   ├── modules/                # Arquitectura modular de la aplicación
│   │   ├── auth/               # Módulo de Autenticación (Login / Register)
│   │   └── user/               # Módulo de Usuarios
│   ├── app.ts                  # Configuración de Express (Middlewares, CORS, Rutas)
│   └── server.ts               # Punto de entrada y arranque del servidor HTTP
├── .env.example                # Variables de entorno de plantilla
├── tsconfig.json
└── package.json
```

## Requisitos previos

Asegúrate de tener instalado:

*   Node.js (v18 o superior)
*   PostgreSQL corriendo localmente o en un contenedor Docker
*   pnpm instalado globalmente (npm i -g pnpm)

## Clonar e Instalar dependencias

```plaintext
# Clonar el repositorio
git clone [https://github.com/tu-usuario/tu-repositorio.git](https://github.com/tu-usuario/tu-repositorio.git)
cd tu-repositorio

# Instalar dependencias
pnpm install
```

## Configurar variables de entorno

Crea un archivo `.env` en la raíz del proyecto copiando el archivo `.env.example` y configura las variables:

```plaintext
cp .env.example .env
```

Configura tus variables en el archivo .env:

```plaintext
DATABASE_URL="postgresql://usuario:password@localhost:5432/tu_base_datos?schema=public"
FRONTEND_URL="http://localhost:5173,http://localhost:3000"
JWT_SECRET="tu_clave_secreta_super_segura"
NODE_ENV="development" # o "production"
PORT=3000
```

## Migraciones y Base de Datos

Aplica las migraciones de Prisma para crear la estructura de tablas y generar los tipos de TypeScript:

```plaintext
pnpm prisma migrate dev --name init
```

Para generar solo los tipos sin aplicar migraciones:

```plaintext
pnpm prisma generate
```

## Orden de Ejecución Inicial

Para que el proyecto y la CLI de Vane queden completamente funcionales, sigue este orden exacto:

1.  `**pnpm install**` — Instala todas las dependencias del proyecto.
2.  `**pnpm build:cli**` — Compila TypeScript a JavaScript dentro de `dist/`. Este comando ejecuta automáticamente el script que enlaza la CLI de Vane globalmente (`pnpm link --global`).
3.  `**pnpm dev**` — Levanta el servidor en modo desarrollo con hot-reload.

**¿Por qué este orden?**  
El comando `**pnpm build:cli**` intenta enlazar el binario definido en `package.json` (`./dist/cli/vane.js`). Si intentas enlazarlo antes de compilar, ese archivo aún no existe y el enlace falla o queda roto. Compilar primero garantiza que `dist/cli/vane.js` ya esté generado en disco antes de que pnpm cree el ejecutable global, evitando errores de archivos faltantes.

## Levantar servidor

```plaintext
pnpm dev
```

## 🛠️ **Vane CLI (Generador de Código)**

El proyecto incluye **Vane**, una herramienta de CLI que automatiza la creación de componentes y arquitectura por módulos. Inspecciona tu `prisma/schema.prisma` para generar esquemas de validación de **Zod** dinámicos y listos para usar.

\> Gracias al enlace global (pnpm build:cli), la CLI se ejecuta directamente con `vane`, sin necesidad de escribir `pnpm vane` en caso de no ejecutar un comando global puedes usar `vane` con `pnpm vane <command></command> <args>` pero aumentara el tiempo de ejecucion (de ~90ms a ~1,500ms).

### Tabla de Comandos

| Comando | Descripción |
| --- | --- |
| `vane <modelo>` | Alias para `make:all`. Lee el modelo en `schema.prisma` y genera el módulo completo en `src/modules/<modelo>/` (Schema Zod, Controller, Service y Routes). |
| `vane make:all <modelo>` | Genera el módulo completo con Zod dinámico a partir de un modelo de Prisma. |
| `vane make:controller <nombre>` | Genera un archivo de controlador en `src/controllers/` (o en subcarpetas). |
| `vane make:service <nombre>` | Genera un archivo de servicio en `src/services/` (o en subcarpetas). |
| `vane make:routes <nombre>` | Genera un archivo de rutas en `src/routes/` (o en subcarpetas). |
| `vane make:middleware <nombre>` | Genera un middleware personalizado en `src/middlewares/`. |

### 💡 Ejemplos de Uso

#### 1\. Módulo completo basado en Prisma (Recomendado)

Asegúrate de tener definido tu modelo en `prisma/schema.prisma` y ejecuta:

```plaintext
vane Producto
# o también:
vane make:all Producto
```

Resultado: Crea la carpeta src/modules/producto/ con:

```plaintext
producto.schema.ts (con validaciones de Zod basadas en las columnas reales de tu modelo).

producto.controller.ts

producto.service.ts

producto.routes.ts (con esquemas de Zod vinculados a POST y PUT).
```

## Comandos individuales por defecto

Genera un archivo aislado en la carpeta global correspondiente:

```plaintext
vane make:controller Auth
# Crea -&gt; src/controllers/auth.controller.ts
```

```plaintext
vane make:service Auth
# Crea -&gt; src/services/auth.service.ts
```

### Notación por puntos (Subcarpetas)

Puedes organizar controladores, servicios o rutas dentro de subcarpetas separando la ruta con puntos (.):

```plaintext
vane make:controller admin.reports.sales
# Crea -&gt; src/controllers/admin/reports/sales.controller.ts
```

### Bandera -m / --module (Estructura modular personalizada)

Si deseas crear un controlador, servicio o ruta individual dentro de la carpeta de módulos (src/modules/), añade la bandera -m:

```plaintext
vane make:controller libro.libro -m
# Crea -&gt; src/modules/libro/libro.controller.ts
```

🔐 **Autenticación & Seguridad**

*   **Login / Registro**: `/api/auth/register` y `/api/auth/login`.
*   **Cookies HttpOnly**: El JWT se almacena y transporta de forma segura mediante **cookies HttpOnly**, mitigando ataques XSS.  
    Rutas Protegidas: Incluye authMiddleware para resguardar endpoints privados validando la firma del token.  
    Validaciones: Esquemas Zod para la verificación estricta de payloads.  
    📜 Scripts Disponibles
*   `pnpm dev`: Ejecuta la app en modo desarrollo con hot-reload (tsx).
*   `pnpm build`: Compila el código de TypeScript a JavaScript en la carpeta dist/ y enlaza la CLI globalmente vía `postbuild`.
*   `pnpm start`: Ejecuta el código compilado en producción (node dist/src/server.js).
*   `vane`: Ejecuta la herramienta de línea de comandos de Vane directamente (ya no requiere `pnpm` como prefijo).  
    📄 LicenciaEste proyecto está bajo la Licencia MIT.
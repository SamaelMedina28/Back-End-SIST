# Estado de implementación del backend

> Corte inicial: 2026-10-03. Esta tabla refleja el análisis de esta etapa. El contrato canónico está en [BACKEND_CONTRACT.md](./BACKEND_CONTRACT.md).

| Módulo | Estado | Endpoints | Tests |
|---|---|---|---|
| Base de API, respuestas y errores | NOT_STARTED | 0/4 fuera de /api/v1; prefijo /api/v1 pendiente | 0 |
| Autenticación Google OAuth y sesión | NOT_STARTED | 0/5 | 0 |
| Usuarios y perfil propio | NOT_STARTED | 0/1 | 0 |
| Catálogo de categorías y subcategorías | NOT_STARTED | 0/8 | 0 |
| Tickets y creación | NOT_STARTED | 0/13 | 0 |
| Timeline / eventos de ticket | NOT_STARTED | Incluido en tickets | 0 |
| Autoasignación y asignación administrativa | NOT_STARTED | Incluido en tickets | 0 |
| Estados, prioridad e idempotencia | NOT_STARTED | Incluido en tickets | 0 |
| Dashboard | NOT_STARTED | 0/1 | 0 |
| Bitácora de actividad | NOT_STARTED | 0/5 | 0 |
| Auditoría de bitácora | NOT_STARTED | Incluido en bitácora | 0 |
| Inventario | NOT_STARTED | 0/7 | 0 |
| Miembros de soporte | NOT_STARTED | 0/5 | 0 |
| Reportes | NOT_STARTED | 0/1 | 0 |
| Notificaciones y outbox | NOT_STARTED | Sin endpoint directo | 0 |
| Health/readiness | NOT_STARTED | 0/2 | 0 |
| OpenAPI / Swagger UI | NOT_STARTED | 0/2 | 0 |
| Seguridad (Helmet, CORS, rate limit, Zod, RBAC) | NOT_STARTED | Transversal | 0 |
| Logging estructurado | NOT_STARTED | Transversal | 0 |
| Seeds y catálogo inicial | NOT_STARTED | Sin endpoint directo | 0 |

## Reutilización exacta del template

- cli/: se conserva como CLI Vane para generar módulos, controladores, servicios, rutas, middlewares y schemas.
- cli/templates/ y cli/utils/: se conservan como base de generación, sujetos a adaptación posterior para el contrato (por ejemplo, evitar any y mass assignment).
- src/app.ts: se reutilizará como punto de composición de Express, pero requiere reemplazar configuración y manejo actuales.
- src/server.ts: se reutilizará como punto de entrada del servidor, incorporando configuración y arranque compatibles con health/readiness.
- src/routes/index.ts: se reutilizará como agregador de rutas, ajustándolo al prefijo /api/v1 y rutas fuera del prefijo.
- src/middlewares/: se reutilizará la ubicación modular; los middlewares actuales requieren rediseño conforme al contrato.
- src/modules/: se reutilizará la convención module.routes.ts, module.controller.ts, module.service.ts, module.schema.ts.
- lib/prisma.ts: se reutilizará como punto único de inicialización de Prisma PostgreSQL, después de alinear el schema y el cliente generado.
- prisma.config.ts: se reutilizará para la configuración de Prisma 7.
- tsconfig.json, package.json, pnpm-lock.yaml: se conservarán como base; deberán actualizarse solo cuando el alcance de una etapa lo requiera.
- Dependencias ya alineadas parcialmente con el stack: Express 5, TypeScript, Prisma 7, PostgreSQL mediante pg, Zod, pnpm, cookies y JWT.

## Código de demostración identificado

Debe retirarse o reemplazarse posteriormente como parte de etapas explícitas, no durante esta documentación:

- Registro/login con contraseña, bcrypt y payload de usuario en src/modules/auth/.
- Campos password, name y entero autoincremental del modelo User.
- Modelo Producto y migraciones/datos de ejemplo de Post, Libro, Uber y Producto.
- Endpoints genéricos de usuarios que consultan por ID entero y exponen operaciones CRUD no contempladas por el contrato.
- Respuestas actuales basadas en message, user y objetos directos, en lugar del sobre success/data/error/meta.
- Cookie jwt, secreto fallback default_secret, lectura Bearer y códigos de error actuales del middleware.
- Plantillas Vane que generan servicios/controladores con any, CRUD genérico y asignación directa de req.body.
- La documentación de README que describe login/registro local y endpoints /api/auth/*; debe actualizarse en una etapa de documentación posterior.

## Verificación de esta etapa

- pnpm build: OK después de generar el cliente Prisma en generated/prisma (artefacto ignorado por Git). La primera ejecución falló porque ese cliente aún no existía.
- No se implementaron endpoints del sistema ni se alteró el schema/migraciones en esta etapa.
- La verificación final queda completada; no se convirtió el artefacto generado en código fuente versionado.

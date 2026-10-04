# Estado de implementación del backend

> Corte de la Etapa 1.5: 2026-10-03. El contrato canónico está en [BACKEND_CONTRACT.md](./BACKEND_CONTRACT.md).

| Módulo | Estado | Endpoints | Tests |
|---|---|---:|---:|
| Modelo de datos Prisma 7 | DONE | 0 | 0 |
| Migración inicial del sistema | DONE (aplicada localmente) | 0 | 0 |
| Seed idempotente de categorías | DONE (probado dos veces) | 0 | 0 |
| PostgreSQL local reproducible | DONE (PostgreSQL local) | 0 | 0 |
| Documentación de base de datos | DONE | 0 | 0 |
| Base de API, respuestas y errores | NOT_STARTED | 0/4 fuera de /api/v1 | 0 |
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
| Notificaciones y outbox worker | NOT_STARTED | Sin endpoint directo | 0 |
| Health/readiness | NOT_STARTED | 0/2 | 0 |
| OpenAPI / Swagger UI | NOT_STARTED | 0/2 | 0 |
| Seguridad (Helmet, CORS, rate limit, Zod, RBAC) | NOT_STARTED | Transversal | 0 |
| Logging estructurado | NOT_STARTED | Transversal | 0 |

## Reutilización y cambios del template

- Se conservan `cli/`, sus plantillas/utilidades y la configuración de TypeScript, pnpm, Express y Prisma 7.
- Se conserva `lib/prisma.ts` como punto de inicialización con `@prisma/adapter-pg` y el cliente en `generated/prisma`.
- Se conserva `prisma.config.ts`, ahora con el seed registrado.
- Se creó `docker-compose.yml` con PostgreSQL 18.6, volumen persistente y healthcheck.
- La validación real de esta etapa utilizó PostgreSQL local, no Docker Compose.
- Se conserva la convención modular de `src/modules/` para etapas HTTP futuras.
- Se eliminó el modelo demo `Producto` y se reemplazó el schema completo por el dominio del sistema.
- Se retiró el código HTTP de autenticación local y CRUD de usuarios del template porque dependía de `password`, entero autoincremental y endpoints fuera del contrato. Esto no implementa OAuth ni nuevos endpoints.
- Se retiró el middleware de autenticación demo que usaba `default_secret`; el middleware OAuth/RBAC queda pendiente.
- Se reorganizó el historial de migraciones porque las cinco migraciones previas eran exclusivamente del template y chocaban con el nuevo `User`. La migración real es `20261003120000_init_support_system`.

## Decisiones y discrepancias documentadas

- `Category.defaultPriority` es nullable: el contrato marca varias categorías como configurables y no proporciona una prioridad. El seed conserva `NULL` en esos casos.
- `Subcategory.priority` es nullable para permitir heredar la prioridad de la categoría.
- `User.institutionalId` es obligatorio y único, conforme al contrato. El flujo de onboarding OAuth deberá resolver la creación/vinculación de usuarios antes de persistir un User incompleto.
- Para un usuario nuevo, el futuro callback de Google validará la identidad y conservará un estado temporal seguro; no creará `User` hasta `complete-profile`, donde llegarán `institutionalId`, `communityType` y `phone` opcional. Los miembros SUPPORT/SUB_MANAGER pre-provisionados se vincularán por email.
- La base local `support_system` pertenece a `samael`; la contraseña no se guarda ni se documenta.
- Las relaciones históricas usan `Restrict`; no hay cascadas destructivas. Las bajas futuras usarán `isActive`.
- `Ticket.number` es un entero autoincremental único y `Ticket.code` queda preparado como único; la generación de `code` pertenece al service futuro.
- Los índices de Ticket cubren filtros individuales y combinaciones previstas para listados grandes.
- Los índices UNIQUE nullable de PostgreSQL permiten múltiples NULL para `duplicateKey`, `dedupeKey`, `assetCode`, `serialNumber` y `googleSubject`; la lógica de uso queda para etapas posteriores.
- No se agregaron usuarios reales ni datos personales al seed.
- No se implementaron controladores, OAuth, servicios de tickets, bitácora, inventario, lógica HTTP, dashboard, reportes, SMTP, worker ni Swagger.

## Verificación

- No se encontraron imports ni referencias de runtime a los modelos demo eliminados.
- `pnpm build` finaliza correctamente después de `prisma generate`.
- `docker compose config` es válido, pero no se utilizó Docker para esta validación.
- Se corrigió la invocación del seed a `node --import tsx prisma/seed.ts`; así se elimina la restricción IPC del binario CLI `tsx`.
- La migración quedó aplicada y `prisma migrate status` reportó el esquema actualizado.
- El seed produjo 10 categorías y 14 subcategorías en la primera ejecución; la segunda mantuvo exactamente esos conteos.
- La consulta real con Prisma recuperó `PROJECTOR_FAILURE` y la subcategoría `BLURRY_IMAGE`.

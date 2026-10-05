# Modelo de datos

Este documento describe el modelo Prisma del Sistema Integral de Soporte Técnico FCQI-UABC. La fuente normativa de nombres, reglas de negocio y API sigue siendo [BACKEND_CONTRACT.md](./BACKEND_CONTRACT.md).

## Entidades

- **User**: identidad institucional y permisos actuales. Se vincula con Google mediante `googleSubject`, no almacena contraseña. `role` representa permisos del sistema; `communityType` representa si la persona es estudiante, docente o administrativa.
- **Category**: categoría técnica del ticket, su área de soporte y prioridad predeterminada. `defaultPriority` es nullable porque el contrato deja algunas categorías configurables.
- **Subcategory**: clasificación específica dentro de una categoría. Su prioridad puede ser nullable para heredar la de Category.
- **SupportSuggestion**: sugerencias reutilizables del catálogo, asociadas a una categoría y opcionalmente a una subcategoría.
- **Ticket**: incidencia reportada. Tiene un UUID interno, un número secuencial y un código público legible. Conserva snapshots del reportero y referencias a categoría, subcategoría, inventario y técnico asignado.
- **TicketEvent**: historial inmutable de cambios relevantes de un ticket. Su `metadata` permite guardar contexto estructurado.
- **ActivityLog**: bitácora de servicio técnico. Registra una actividad y sus snapshots históricos, además del tiempo de servicio y estado.
- **ActivityParticipant**: tabla explícita de relación N:M entre actividades y usuarios participantes.
- **ActivityLogRevision**: historial inmutable de cambios de la bitácora.
- **InventoryItem**: equipo o accesorio inventariable. Los campos operativos son nullable porque sus requisitos dependen de `InventoryType`; la validación condicional pertenece a Zod/services.
- **NotificationOutbox**: cola transaccional de notificaciones. Se escribe junto con el cambio de dominio y se procesa fuera de la petición HTTP.
- **IdempotencyRecord**: respuesta persistida para operaciones HTTP idempotentes. La clave es única por usuario y scope; el hash identifica el payload y `expiresAt` limita la retención lógica a 24 horas.

## Relaciones principales

- User reporta y puede tener asignados Tickets.
- Category contiene Subcategory y clasifica Tickets.
- Ticket puede referenciar un InventoryItem, un assignee y múltiples TicketEvent/ActivityLog/NotificationOutbox.
- TicketEvent pertenece a Ticket y puede tener actor User o ser generado por sistema.
- ActivityLog pertenece a Ticket y a su creador User.
- ActivityParticipant conecta ActivityLog con User sin duplicar participantes.
- ActivityLogRevision pertenece a ActivityLog y registra quién realizó el cambio.
- SupportSuggestion pertenece a Category y opcionalmente a Subcategory.
- IdempotencyRecord pertenece a User y se elimina/reemplaza al volver a usar una clave expirada.

Las relaciones históricas usan restricciones que impiden borrar físicamente registros referenciados. Los módulos futuros deben usar `isActive` para bajas lógicas.

## Enums

- **Role**: `USER`, `SUPPORT`, `SUB_MANAGER`, `ADMIN`. Determina capacidades y autorización.
- **CommunityType**: `STUDENT`, `TEACHER`, `ADMINISTRATIVE`. Describe la comunidad institucional.
- **SupportArea**: áreas funcionales de soporte.
- **TicketPriority**: `LOW`, `MEDIUM`, `HIGH`.
- **TicketStatus**: ciclo de vida del ticket.
- **InventoryType**: tipo de artículo inventariable.
- **TicketEventType**: tipos de eventos históricos.
- **NotificationStatus**: estado del procesamiento de outbox.

### Role y CommunityType

No son equivalentes:

- `role` controla qué operaciones puede realizar la cuenta.
- `communityType` identifica la relación de la persona con la institución.

Por ejemplo, una persona puede tener `communityType = STUDENT` y `role = SUPPORT`, como miembro de soporte pre-registrado.

## Ticket y ActivityLog

Un **Ticket** es la incidencia y su estado operativo: quién la reportó, dónde ocurre, prioridad, asignación y resolución.

Un **ActivityLog** es una entrada de trabajo técnico asociada a un ticket. Un ticket puede tener varias actividades y cada actividad puede tener varios participantes. La bitácora no reemplaza el ticket ni sus eventos.

## Snapshots

Los snapshots preservan el contexto histórico en el momento de crear el registro. Por ejemplo, un ticket conserva el nombre, correo, teléfono y tipo de comunidad del reportero aunque la cuenta cambie después. La duplicación es intencional y evita que el historial dependa de valores actuales.

## Soft delete

Una baja lógica establece `isActive = false` en lugar de eliminar la fila. Se utiliza para categorías, subcategorías, inventario y usuarios de soporte. Esto mantiene referencias y permite conservar reportes y auditoría.

Las relaciones críticas usan `Restrict`; no se configuraron cascadas destructivas para datos históricos. Las futuras rutas de “eliminación” deben implementar soft delete.

## Onboarding OAuth

`User.institutionalId` permanece obligatorio y unique. Para una identidad de Google que todavía no existe en la base de datos, el callback no crea un `User` incompleto:

1. Validará la identidad, el dominio y `email_verified`.
2. Guardará un estado temporal de onboarding seguro.
3. Redirigirá al frontend a `/auth/complete-profile`.
4. Recibirá `institutionalId`, `communityType` y `phone` opcional.
5. Creará el `User` con todos sus campos obligatorios y `role = USER`.

Para miembros `SUPPORT` o `SUB_MANAGER` preaprovisionados, el flujo busca la cuenta por email y vincula `googleSubject` sin crear un registro nuevo ni modificar su rol, áreas o habilidades.

Este flujo quedó implementado en la Etapa 2 y se cubrió con pruebas automatizadas mediante un proveedor de Google simulado. La comprobación manual contra Google real sigue pendiente de credenciales.

## PostgreSQL local

La Etapa 5 añade `20261004200132_add_ticket_status_idempotency`, una migración aditiva que crea `IdempotencyRecord`, un índice por `expiresAt`, la unicidad `(userId, scope, key)` y una FK restrictiva a `User`. La aplicación ignora registros vencidos al resolver solicitudes; no hay todavía un worker de limpieza. Las claves solo se guardan para cambios de estado con `Idempotency-Key` y se retienen lógicamente por 24 horas.

La Etapa 6 añade `20261004202126_add_activity_log_service_time_index`, que crea un índice compuesto descendente sobre `ActivityLog.serviceStartedAt`, `createdAt` e `id`. Da soporte al filtro/rango y al orden determinista principal del listado de bitácora. No agrega modelos, columnas ni cambios de enums. `ActivityLogRevision` no tiene mutaciones en la API; las rutas solo insertan revisiones y las leen en orden ascendente.

La Etapa 7 añade `20261004212600_add_inventory_ticket_history_index`, índice compuesto sobre `Ticket.inventoryItemId`, `createdAt DESC` e `id`. Acelera el historial paginado por artículo, su orden determinista y consultas de la clave foránea; no añade tablas ni columnas ni altera tickets históricos.

La Etapa 9 no requiere migración: los índices existentes de `Ticket` sobre `status`, `(assigneeId, status)`, `(reporterId, status)`, `Category.supportArea` y `User(role, isActive)` cubren los filtros principales del dashboard; los contadores se resuelven con agregaciones. `APP_TIMEZONE` valida una zona IANA al iniciar y vale `America/Tijuana` por defecto. `completedToday` usa los límites del día local convertidos a UTC, sin offset fijo, por lo que respeta el horario estacional.

La Etapa 10 añade `20261004212700_add_ticket_status_completed_at_index`, un índice aditivo `Ticket(status, completedAt)` para la cohorte de completados del reporte. Se aplicó mediante `migrate deploy` a `support_system_test` y `support_system`; en esta última solo se creó el índice, sin reset, truncate ni limpieza de datos. El índice existente de `createdAt` cubre la cohorte de creaciones. Las consultas del reporte agregan en PostgreSQL y agrupan días con la conversión desde timestamps UTC de Prisma a `APP_TIMEZONE`.

La Etapa 11 añade `20261004220000_add_notification_claim_state`: agrega `PROCESSING` y `SKIPPED` a `NotificationStatus` y columnas nullable `NotificationOutbox.lockedAt`/`lockedBy` para claims recuperables entre instancias. Se aplicó a `support_system_test` y `support_system` con `migrate deploy`; es una migración aditiva y no altera filas existentes.

La validación de esta etapa utiliza el PostgreSQL local del equipo, con base `support_system` y usuario `samael`. La contraseña no se guarda en el repositorio ni en esta documentación.

Para configurar la aplicación localmente:

1. Copia `.env.example` como `.env`.
2. Edita únicamente `DATABASE_URL` y reemplaza `USER:PASSWORD` por `samael:<PASSWORD_LOCAL>`:

```dotenv
DATABASE_URL="postgresql://samael:<PASSWORD_LOCAL>@localhost:5432/support_system"
```

3. No compartas ni confirmes la contraseña en el repositorio, mensajes o documentación.

Con una conexión local configurada, los comandos habituales son:

```bash
pnpm prisma migrate deploy
pnpm prisma db seed
pnpm build
```

Como alternativa, otros desarrolladores pueden utilizar `docker-compose.yml` con su propia base de desarrollo.

## Migraciones

Prisma utiliza `prisma/schema.prisma` como modelo y `prisma/migrations/` como historial versionado.

Crear una migración en desarrollo:

```bash
DATABASE_URL="postgresql://..." pnpm prisma migrate dev --name nombre_de_la_migracion
```

Aplicar migraciones ya versionadas:

```bash
DATABASE_URL="postgresql://..." pnpm prisma migrate deploy
```

Las migraciones antiguas incluidas en el template corresponden a modelos de demostración. La migración del sistema se genera como una migración inicial para una base limpia; no debe aplicarse ciegamente sobre una base que ya tenga datos del template.

## Seed

El seed idempotente está en `prisma/seed.ts` y se registra en `prisma.config.ts` usando `node --import tsx`, una invocación compatible con el runtime de Prisma 7 que evita depender del canal IPC del binario CLI de `tsx`.

Ejecutarlo:

```bash
DATABASE_URL="postgresql://..." pnpm prisma db seed
```

Carga y actualiza las categorías y subcategorías definidas por el contrato. No crea usuarios reales ni datos personales.

Las prioridades no especificadas por el contrato se mantienen en `NULL`, para que una etapa administrativa posterior pueda configurarlas sin inventar una prioridad.

## Prisma Client

Generar el cliente en `generated/prisma`:

```bash
DATABASE_URL="postgresql://..." pnpm prisma generate
```

La aplicación mantiene el patrón existente con `@prisma/adapter-pg` y toma la conexión exclusivamente de `DATABASE_URL`.

## Prisma Studio

Con una `DATABASE_URL` válida, abrir Prisma Studio:

```bash
DATABASE_URL="postgresql://..." pnpm prisma studio
```

Prisma Studio sirve para inspección y desarrollo. Las modificaciones de esquema deben hacerse mediante el schema y migraciones versionadas.

## Base de datos de pruebas

La etapa Tickets Core usa PostgreSQL real en `support_system_test`. Los tests previos de auth y catálogo siguen usando repositorios en memoria. La variable `DATABASE_URL_TEST` es independiente de `DATABASE_URL`; nunca uses el valor de desarrollo para esta suite.

Preparación inicial, con un usuario PostgreSQL que pueda crear bases:

```bash
createdb -h localhost support_system_test
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/support_system_test" pnpm exec prisma migrate deploy
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/support_system_test" pnpm exec prisma db seed
DATABASE_URL_TEST="postgresql://USER:PASSWORD@localhost:5432/support_system_test" pnpm test
```

Si la base ya existe, omite `createdb`. En un equipo con autenticación local por socket, ajusta la URL de conexión sin guardar credenciales en Git. La suite verifica antes de conectarse que el nombre configurado termina en `_test`, consulta `current_database()` y exige exactamente `support_system_test` antes de truncar fixtures. Limpia solo tablas de la base de pruebas, conserva el seed de categorías y elimina al terminar las categorías temporales `TEST_CORE_*`. Si `DATABASE_URL_TEST` no está definida, los tests PostgreSQL se omiten; para verificar esta etapa hay que ejecutarlos con la variable configurada. No se resetea ni limpia `support_system`.

La migración inicial ya define `Ticket.number` como `SERIAL` y un índice `UNIQUE` nullable sobre `duplicateKey`. La clave vigente es SHA-256 de categoría, edificio normalizado y aula normalizada; **no incluye subcategoría**. Al crear tickets, la transacción bloquea la fila `User` del reportero con `FOR UPDATE`, cuenta los estados activos, consume `nextval` de la secuencia real, inserta Ticket y después TicketEvent CREATED. La secuencia puede dejar huecos si la transacción revierte; número y código siguen siendo únicos y coherentes. Los estados COMPLETED/CANCELLED liberan `duplicateKey` al ponerlo en `NULL`.

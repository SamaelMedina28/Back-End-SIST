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

## Relaciones principales

- User reporta y puede tener asignados Tickets.
- Category contiene Subcategory y clasifica Tickets.
- Ticket puede referenciar un InventoryItem, un assignee y múltiples TicketEvent/ActivityLog/NotificationOutbox.
- TicketEvent pertenece a Ticket y puede tener actor User o ser generado por sistema.
- ActivityLog pertenece a Ticket y a su creador User.
- ActivityParticipant conecta ActivityLog con User sin duplicar participantes.
- ActivityLogRevision pertenece a ActivityLog y registra quién realizó el cambio.
- SupportSuggestion pertenece a Category y opcionalmente a Subcategory.

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

# API del sistema de soporte técnico

La API funcional usa el prefijo `/api/v1`. Las respuestas JSON exitosas siguen `{ "success": true, "data": ... }`; los errores incluyen `success`, `error` y `requestId`. Todas las rutas descritas aquí requieren una sesión por cookie salvo el inicio/callback OAuth y `complete-profile`, que requiere la cookie de onboarding.

## Autenticación

### `GET /api/v1/auth/google`

- Rol: público.
- Request: navegación del navegador, sin body.
- Response: `302` hacia Google.
- Errores: `429 RATE_LIMIT_EXCEEDED`.

```ts
window.location.href = `${API_URL}/api/v1/auth/google`;
```

### `GET /api/v1/auth/google/callback`

- Rol: callback OAuth, protegido por `state` y PKCE.
- Request: query `code` y `state` enviados por Google.
- Response: `302` hacia `/auth/success` o `/auth/complete-profile` del frontend.
- Errores: `400 OAUTH_CODE_MISSING`, `401 OAUTH_STATE_INVALID`, `403` por correo/dominio, `409 GOOGLE_ACCOUNT_CONFLICT`, `429 RATE_LIMIT_EXCEEDED`.

### `POST /api/v1/auth/complete-profile`

- Rol: onboarding válido mediante cookie HTTP-only.
- Request:

```json
{
  "institutionalId": "1287456",
  "communityType": "STUDENT",
  "phone": null
}
```

- Response: `201` con usuario público y cookie de sesión.
- Errores: `401 ONBOARDING_REQUIRED` / `ONBOARDING_EXPIRED`, `409 EMAIL_ALREADY_REGISTERED` / `INSTITUTIONAL_ID_ALREADY_REGISTERED`, `422 VALIDATION_ERROR`.

### `GET /api/v1/auth/me`

- Rol: cualquier usuario autenticado.
- Request: cookie de sesión.
- Response: `200` con el perfil público actual.
- Errores: `401 AUTHENTICATION_REQUIRED` / `INVALID_SESSION`, `403 USER_DISABLED`.

### `POST /api/v1/auth/logout`

- Rol: sesión opcional; operación idempotente.
- Request: sin body.
- Response: `204 No Content`.

### `PATCH /api/v1/users/me`

- Rol: cualquier usuario autenticado.
- Request: solo `fullName` y/o `phone`.
- Response: `200` con el perfil actualizado.
- Errores: `401`, `403 USER_DISABLED`, `422 VALIDATION_ERROR`.

```ts
await api("/users/me", {
  method: "PATCH",
  body: JSON.stringify({ fullName: "Nombre Apellido", phone: null }),
});
```

## Categorías

Los códigos se validan como `UPPER_SNAKE_CASE` y quedan estables. Los listados se ordenan por nombre ascendente y desempatan por UUID ascendente; las subcategorías se ordenan igual. Las prioridades pueden ser `null` y nunca se reemplazan por un valor inventado. Cuando ambas prioridades son nulas, la prioridad efectiva sigue siendo `null`.

### `GET /api/v1/categories`

- Rol: cualquier usuario autenticado.
- Query: `includeInactive=true` es exclusivo de `ADMIN`; otros roles reciben `403 FORBIDDEN`.
- Response: `200` con categorías visibles y subcategorías activas. `includeInactive=true` también incluye categorías inactivas, pero no cambia el filtro de subcategorías.
- Errores: `401`, `403`, `422 VALIDATION_ERROR`.

### `POST /api/v1/categories`

- Rol: `ADMIN`.
- Request:

```json
{
  "code": "PROJECTOR_FAILURE",
  "name": "Falla de proyector",
  "supportArea": "HARDWARE",
  "defaultPriority": null,
  "requiresSoftwareDetails": false
}
```

- Response: `201` con categoría creada.
- Errores: `401`, `403`, `409 CATEGORY_CODE_ALREADY_EXISTS`, `422 VALIDATION_ERROR`.

### `PATCH /api/v1/categories/:id`

- Rol: `ADMIN`.
- Request: campos parciales entre `name`, `supportArea`, `defaultPriority`, `requiresSoftwareDetails` e `isActive`. `code`, IDs y timestamps no se aceptan.
- Response: `200` con categoría actualizada.
- Errores: `401`, `403`, `404 CATEGORY_NOT_FOUND`, `422 VALIDATION_ERROR`.

### `DELETE /api/v1/categories/:id`

- Rol: `ADMIN`.
- Request: UUID en el path.
- Response: `204`; establece `isActive=false` y es idempotente. No elimina subcategorías ni registros históricos.
- Errores: `401`, `403`, `404 CATEGORY_NOT_FOUND`, `422 VALIDATION_ERROR`.

### `POST /api/v1/categories/:categoryId/subcategories`

- Rol: `ADMIN`.
- Request: `{ "code": "CONNECTION_FAILURE", "name": "Falla de conexión", "priority": "HIGH" }`. `priority` puede ser `null` u omitirse.
- Response: `201` con subcategoría.
- Errores: `401`, `403`, `404 CATEGORY_NOT_FOUND`, `409 CATEGORY_INACTIVE` / `SUBCATEGORY_CODE_ALREADY_EXISTS`, `422 VALIDATION_ERROR`.

### `PATCH /api/v1/subcategories/:id`

- Rol: `ADMIN`.
- Request: campos parciales entre `name`, `priority` e `isActive`. No permite cambiar `code`, `categoryId`, IDs ni timestamps.
- Response: `200` con subcategoría actualizada.
- Errores: `401`, `403`, `404 SUBCATEGORY_NOT_FOUND`, `422 VALIDATION_ERROR`.

### `DELETE /api/v1/subcategories/:id`

- Rol: `ADMIN`.
- Request: UUID en el path.
- Response: `204`; establece `isActive=false` y es idempotente.
- Errores: `401`, `403`, `404 SUBCATEGORY_NOT_FOUND`, `422 VALIDATION_ERROR`.

## Catálogo

### `GET /api/v1/catalog/ticket-form`

- Rol: cualquier usuario autenticado.
- Request: sin parámetros.
- Response: `200` con categorías/subcategorías activas y `maxActiveTickets: 10`.
- Errores: `401`.

```json
{
  "success": true,
  "data": {
    "categories": [],
    "maxActiveTickets": 10
  }
}
```

El contenido procede de PostgreSQL; las prioridades nulas se conservan. La creación de tickets aplica el límite de 10 activos para `USER`.

### `GET /api/v1/catalog/support-suggestions`

- Rol: cualquier usuario autenticado.
- Query obligatoria: `categoryId` UUID. Query opcional: `subcategoryId` UUID.
- Response: `200` con sugerencias activas o `[]` si todavía no hay contenido. Con subcategoría se incluyen sugerencias generales de la categoría y las específicas de esa subcategoría.
- Errores: `401`, `404 CATEGORY_NOT_FOUND` / `SUBCATEGORY_NOT_FOUND`, `422 VALIDATION_ERROR`.

No se sembraron sugerencias ficticias. El endpoint devuelve `[]` hasta que existan filas activas cargadas en la tabla.

## Tickets Core

Las cuatro rutas requieren la cookie de sesión HTTP-only. Solo `USER` crea tickets y siempre es el reportero de su propio ticket; puede ver solo sus reportes. `SUPPORT` y `SUB_MANAGER` ven tickets de sus `supportAreas`; `ADMIN` ve todos.

### `POST /api/v1/tickets`

Crea un ticket y su evento inicial. Body JSON estricto:

```json
{
  "title": "Proyector sin señal",
  "categoryId": "UUID",
  "subcategoryId": "UUID",
  "building": "Edificio 6",
  "room": "603",
  "description": "El proyector enciende pero no muestra señal.",
  "contactPhone": null,
  "inventoryItemId": null
}
```

`title` tiene máximo 150 caracteres tras `trim`; `description`, máximo 50 palabras separadas por espacios Unicode. `room`, `contactPhone` e `inventoryItemId` son opcionales o null; `subcategoryId` también acepta null, pero es obligatoria cuando la categoría tiene subcategorías activas. El teléfono acepta formatos habituales con al menos siete dígitos. Si `category.requiresSoftwareDetails` es true, solo `TEACHER` puede crear la solicitud y debe añadir `software` completo: `name`, `version`, `downloadUrl` (URL válida) y `coordinationApprovalReference`. En otras categorías, `software` se rechaza. Se valida que el inventario exista y esté activo cuando se indica un artículo.

El backend calcula `priority = subcategory.priority ?? category.defaultPriority`; si ambas son null responde `409 TICKET_PRIORITY_NOT_CONFIGURED`. Guarda `status=OPEN`, snapshots del reportero y teléfono `contactPhone ?? user.phone ?? null`. Genera `number` desde la secuencia PostgreSQL y `code` como `TK-` más el número con al menos seis dígitos. La ubicación visible conserva sus valores recortados; `duplicateKey` usa SHA-256 de categoría, subcategoría y ubicación normalizada NFKC/minúsculas/espacios colapsados. El índice único impide duplicados activos incluso entre reporteros. `Ticket` y `TicketEvent CREATED` se guardan en la misma transacción.

Respuesta `201`:

```json
{
  "success": true,
  "data": {
    "id": "UUID", "code": "TK-001045", "title": "Proyector sin señal",
    "description": "El proyector enciende pero no muestra señal.",
    "category": { "id": "UUID", "code": "PROJECTOR_FAILURE", "name": "Falla de proyector" },
    "subcategory": { "id": "UUID", "code": "CONNECTION_FAILURE", "name": "Falla de conexión" },
    "location": { "building": "Edificio 6", "room": "603" },
    "priority": "HIGH", "status": "OPEN", "assignee": null,
    "createdAt": "2026-10-03T12:00:00.000Z"
  }
}
```

Errores: `401 AUTHENTICATION_REQUIRED`; `403 FORBIDDEN` para roles distintos de `USER` o `SOFTWARE_REQUEST_REQUIRES_TEACHER` para comunidad distinta de docente; `404 CATEGORY_NOT_FOUND`, `SUBCATEGORY_NOT_FOUND`, `INVENTORY_ITEM_NOT_FOUND`; `409 CATEGORY_INACTIVE`, `SUBCATEGORY_INACTIVE`, `INVENTORY_ITEM_INACTIVE`, `TICKET_PRIORITY_NOT_CONFIGURED`, `DUPLICATE_TICKET`, `ACTIVE_TICKET_LIMIT_REACHED`; `422 VALIDATION_ERROR` o `SUBCATEGORY_CATEGORY_MISMATCH`. Los errores conservan `{ success: false, error: { code, message, fields? }, requestId }`.

```ts
const ticket = await api("/tickets", { method: "POST", body: JSON.stringify({
  title: "Proyector sin señal", categoryId, subcategoryId, building: "Edificio 6",
  room: "603", description: "El proyector enciende pero no muestra señal.",
  contactPhone: null, inventoryItemId: null,
}) });
```

### `GET /api/v1/tickets`

Lista solo tickets visibles para el rol. Query opcional: `page` (default 1), `pageSize` (default 20, máximo 100), `search` (código o título sin distinguir mayúsculas), `status`, `priority`, `categoryId`, `subcategoryId`, `assignment`, `assignedTo`, `supportArea`, `createdFrom`, `createdTo`, `sort` y `order`. `status` acepta un único estado. `assignment` acepta `mine`, `unassigned` o `assigned`; `USER` no puede enviar `assignment`, `assignedTo` ni `supportArea` (403). Para `SUPPORT`/`SUB_MANAGER`, `supportArea` debe ser propia o responde `403 SUPPORT_AREA_FORBIDDEN`. Los filtros solo reducen el conjunto autorizado.

`createdFrom` y `createdTo` son instantes ISO con zona horaria; ambos límites son inclusivos y `createdFrom <= createdTo`. `sort` permite `createdAt`, `updatedAt`, `priority`, `status`, `code`; `order` permite `asc`/`desc`. Default: `createdAt desc`; un empate se resuelve por UUID ascendente. UUID, fechas, enum, sort o pageSize inválidos responden `422 VALIDATION_ERROR`. Una UUID inexistente como filtro devuelve lista vacía.

Respuesta `200`: `{ "success": true, "data": [{ "id": "UUID", "code": "TK-000001", "title": "...", "category": { "id": "UUID", "name": "..." }, "subcategory": null, "location": { "building": "...", "room": null }, "priority": "HIGH", "status": "OPEN", "assignee": null, "createdAt": "ISO_DATE" }], "meta": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 } }`. El listado omite snapshots y `duplicateKey`.

```ts
const response = await fetch(`${API_URL}/api/v1/tickets?page=1&pageSize=20&status=OPEN`, { credentials: "include" });
const { data, meta } = await response.json();
```

### `GET /api/v1/tickets/:id`

`id` debe ser UUID. Responde `200` con detalle, incluyendo descripción, reportero desde snapshots históricos (`id`, `fullName`, `email`, `phone`, `communityType`), categoría y subcategoría, ubicación, prioridad, estado, asignado, resumen de inventario, `software` o null y fechas `createdAt`, `updatedAt`, `assignedAt`, `completedAt`, `cancelledAt`. Si el ticket no existe: `404 TICKET_NOT_FOUND`; si existe pero está fuera del alcance: `403 FORBIDDEN_TICKET`; UUID inválido: `422 VALIDATION_ERROR`.

```ts
const ticket = await api(`/tickets/${ticketId}`);
```

### `GET /api/v1/tickets/:id/events`

Misma visibilidad que el detalle y los mismos errores `403`/`404`/`422`. Responde `200` con `{ success: true, data: [{ id, type, actor: { id, fullName } | null, fromStatus, toStatus, metadata, createdAt }] }`. El timeline se ordena por `createdAt ASC, id ASC`; el evento inicial es `CREATED`, `fromStatus=null`, `toStatus=OPEN` y actor igual al reportero.

```ts
const events = await api(`/tickets/${ticketId}/events`);
```

## Asignación y mutaciones de tickets

Todas estas rutas requieren sesión. Las mutaciones persisten el cambio y su `TicketEvent` en la misma transacción; los tickets `COMPLETED` y `CANCELLED` son terminales.

### `POST /api/v1/tickets/:id/assign-self`

Solo `SUPPORT` y `SUB_MANAGER`. El ticket debe estar activo, sin asignar y dentro de las áreas del actor. La fila del ticket se bloquea en PostgreSQL: ante solicitudes simultáneas solo una gana (`200`); las demás reciben `409 TICKET_ALREADY_ASSIGNED`. Emite `ASSIGNED` con `assignmentType: "SELF"`.

### `PUT /api/v1/tickets/:id/assignee`

Solo `ADMIN`. Body estricto: `{ "assigneeId": "UUID" }`. El destino debe ser un usuario activo `SUPPORT` o `SUB_MANAGER` cuya área incluya la categoría. Permite reasignar; volver a asignar al mismo usuario es idempotente y no repite el evento. Errores relevantes: `ASSIGNEE_NOT_FOUND`, `ASSIGNEE_INACTIVE`, `INVALID_ASSIGNEE_ROLE`, `ASSIGNEE_AREA_MISMATCH`, `TICKET_NOT_ACTIVE`.

### `DELETE /api/v1/tickets/:id/assignee`

Solo `ADMIN`. Retira asignación y emite `UNASSIGNED`; si ya no hay asignado, responde `204` sin evento. Solo aplica a tickets activos.

### `PATCH /api/v1/tickets/:id/status`

`ADMIN` puede cambiar tickets de cualquier área; `SUPPORT`/`SUB_MANAGER` debe estar dentro del área y ser el asignado. Transiciones admitidas: `OPEN → IN_REVIEW`, `OPEN → IN_PROGRESS`, `IN_REVIEW → IN_PROGRESS`, `IN_PROGRESS → COMPLETED`; desde cualquiera de esos tres estados también se puede pasar a `CANCELLED`. No se permite retroceso ni modificación de estados terminales. Mismo estado no crea evento.

Body estricto: `{ "status": "IN_PROGRESS", "note": "Diagnóstico iniciado" }`; `note` es opcional salvo al cancelar, donde es obligatoria (1–500 caracteres) y se guarda como `cancellationReason`. `COMPLETED` fija `completedAt`; `CANCELLED` fija `cancelledAt`; cada cierre limpia el timestamp/reason opuestos y `duplicateKey`, sin retirar al asignado. Los cambios intermedios preservan `duplicateKey`. Cada cambio real emite `STATUS_CHANGED` con from/to y metadata de la nota.

El encabezado opcional `Idempotency-Key` acepta 1–200 caracteres ASCII imprimibles sin espacios. Se recomienda generar una clave por intento lógico y reutilizarla únicamente al reintentar exactamente el mismo body. El éxito completo se guarda en PostgreSQL por usuario, ruta y ticket durante 24 horas; mismo key/body reproduce la respuesta y mismo key con otro body responde `409 IDEMPOTENCY_CONFLICT`. Una transacción bloqueada serializa reintentos concurrentes y solo crea un evento.

### `PATCH /api/v1/tickets/:id/priority`

Solo `ADMIN`, para tickets activos. Body: `{ "priority": "HIGH", "reason": "Impacto en clase" }`; razón obligatoria, de 1 a 500 caracteres. Mismo valor no genera evento. Los cambios reales emiten `PRIORITY_CHANGED` con prioridad anterior, nueva prioridad y razón. Ticket terminal: `409 TICKET_NOT_ACTIVE`.

## Documentación interactiva

- Swagger UI: `GET /api/docs`
- OpenAPI JSON: `GET /api/openapi.json`

El documento describe las rutas implementadas de auth, perfil, catálogo, categorías, subcategorías, Tickets Core, asignación, estado, prioridad y health/readiness.

## Ejemplo del helper frontend

```ts
await api("/catalog/ticket-form");
await api("/categories");
await api(`/catalog/support-suggestions?categoryId=${categoryId}&subcategoryId=${subcategoryId}`);
```

La gestión de categorías/subcategorías requiere `ADMIN`; los usuarios ordinarios solo consultan el catálogo activo.

## Reporte de actividad (ADMIN)

### `GET /api/v1/reports/activity`

Requiere sesión ADMIN. `from` y `to` son fechas locales reales `YYYY-MM-DD`, obligatorias, inclusivas y con `from <= to`; `supportArea` (`HARDWARE`, `SOFTWARE`, `NETWORKS`, `ADMINISTRATIVE`), `categoryId` y `technicianId` son filtros opcionales combinados con AND. `categoryId` y `technicianId` son UUID. Una fecha, enum o UUID inválida responde `422 VALIDATION_ERROR`; falta de sesión, `401`; los demás roles, `403`. UUID válidos sin actividad generan agregados en cero.

Ejemplo: `GET /api/v1/reports/activity?from=2026-09-01&to=2026-09-30&supportArea=HARDWARE`.

La respuesta mantiene la forma del contrato: `{ "success": true, "data": { "summary": { ... }, "byCategory": [...], "byTechnician": [...], "daily": [...] } }`. No incluye `period` ni `filters`; el cliente conserva los valores enviados. `daily` devuelve todos los días locales del rango, incluso sin actividad, con `created: 0` y `completed: 0`.

`ticketsCreated` cuenta todos los creados en el rango por `createdAt`; `ticketsCompleted` cuenta los actualmente `COMPLETED` por `completedAt`, incluso si nacieron antes. `pending` cuenta los creados en el rango que **ahora** siguen `OPEN`, `IN_REVIEW` o `IN_PROGRESS`, no el estado histórico al final del periodo. `averageResolutionMinutes` promedia `completedAt - createdAt` sobre la cohorte completada, redondea al entero más cercano y vale cero sin resoluciones. Son cohortes distintas, no cifras aditivas.

`byCategory` agrupa los creados, omite categorías sin actividad y ordena por `count DESC`, nombre e ID. `byTechnician` muestra SUPPORT/SUB_MANAGER con `completed` por fecha de resolución o `active` por fecha de creación y estado actual; incluye inactivos con actividad, excluye tickets sin asignar y ordena por completados, activos, nombre e ID. `technicianId` siempre filtra `Ticket.assigneeId` actual/final. Los filtros también afectan `daily`. El backend usa los días de `APP_TIMEZONE` (por defecto `America/Tijuana`) y límites UTC semiabiertos, incluidos cambios estacionales.

`byCategory.category` y `byTechnician.name` son los nombres **actuales** de Category y User; Ticket no conserva snapshots de esos nombres para este reporte. Pueden diferir de los nombres que tenían cuando ocurrió la actividad.

## Dashboard por rol

### `GET /api/v1/dashboard`

Requiere cookie de sesión; no recibe body ni necesita query. El backend toma el rol actual del usuario autenticado, no del cliente. Sin sesión responde `401 AUTHENTICATION_REQUIRED`. Solo existe esta ruta de dashboard, disponible para `USER`, `SUPPORT`, `SUB_MANAGER` y `ADMIN`. La respuesta es siempre `{ "success": true, "data": { ... } }`, pero `data` cambia según el rol:

- `USER`: `stats.active` cuenta tickets propios `OPEN`, `IN_REVIEW` o `IN_PROGRESS`; `inProgress` cuenta solo propios `IN_PROGRESS`; `completed` cuenta propios `COMPLETED`, nunca `CANCELLED`. `recentTickets` son los últimos cinco tickets propios (`createdAt DESC`, `id ASC`) con la misma forma de `TicketListItem` del listado.
- `SUPPORT` y `SUB_MANAGER`: solo consideran tickets de las áreas en `supportAreas`. `unassigned` cuenta activos sin asignado; `mine`, activos asignados al usuario; `highPriority`, activos visibles de prioridad `HIGH`; `completedToday`, completados asignados al usuario durante el día local de `APP_TIMEZONE`. `priorityTickets` contiene como máximo diez activos visibles, ordenados `HIGH`, `MEDIUM`, `LOW` y, dentro de cada prioridad, `createdAt ASC`, `id ASC`; usa `TicketListItem`.
- `ADMIN`: `activeTickets` cuenta todos los activos; `unassigned`, todos los activos sin asignado; `activeTechnicians`, usuarios activos con rol `SUPPORT`/`SUB_MANAGER`; `inventoryItems`, artículos activos. `technicianWorkload` incluye también técnicos activos sin tickets y expone solo `userId`, `name`, `supportAreas`, `activeTickets` asignados y `completedToday` asignados. Orden: carga activa descendente, nombre ascendente, id ascendente.

`completedToday` usa un rango UTC `[inicio del día local, inicio del día local siguiente)` calculado con la zona IANA configurada. No usa el día UTC ni un offset fijo; respeta cambios estacionales. El dashboard es informativo y de solo lectura; dos contadores podrían reflejar instantes cercanos pero distintos durante escrituras concurrentes.

## Bitácora y auditoría

Los estados de una actividad son `IN_PROGRESS` y `COMPLETED`. El ticket relacionado debe estar `IN_PROGRESS` o `COMPLETED`. Los snapshots de ticket y reportero los genera el backend desde el ticket; las actualizaciones posteriores del ticket no los sincronizan.

### `GET /api/v1/activity-log`

Roles: `SUPPORT`, `SUB_MANAGER`, `ADMIN`. SUPPORT y SUB_MANAGER solo ven tickets de sus `supportAreas`; ADMIN ve todos. Los filtros siempre restringen ese ámbito. Query: `page` (1), `pageSize` (20, máximo 100), `ticketId`, `technicianId` (ActivityParticipant.userId), `status` (`IN_PROGRESS`/`COMPLETED`), `search`, `from`, `to`. Search es case-insensitive sobre código/título/falla/reportero snapshot y actividad. El rango inclusivo filtra `serviceStartedAt`; acepta ISO DateTime con zona o `YYYY-MM-DD` (UTC completo para la fecha final). `from > to`, UUID inválido, status inválido o pageSize mayor a 100 producen `422 VALIDATION_ERROR`.

```ts
const response = await fetch(`${API_URL}/api/v1/activity-log?page=1&pageSize=20&status=IN_PROGRESS`, { credentials: "include" });
const envelope = await response.json();
if (!response.ok) throw new Error(envelope.error.message);
const { data, meta } = envelope;
```

### `POST /api/v1/activity-log`

Roles: `SUB_MANAGER` (solo sus áreas) y `ADMIN` (cualquier área). Body estricto:

```json
{
  "ticketId": "UUID",
  "activity": "Diagnóstico de conectividad y revisión de cableado.",
  "participantIds": ["UUID"],
  "serviceStartedAt": "2026-10-04T17:00:00.000Z",
  "serviceEndedAt": null,
  "timeSpentMinutes": 90,
  "status": "IN_PROGRESS"
}
```

Se exige al menos un participante único, activo y con rol SUPPORT/SUB_MANAGER/ADMIN; no se restringe el área del participante. `timeSpentMinutes` es entero positivo de tiempo efectivo, no se calcula desde las fechas. COMPLETED requiere `serviceEndedAt`; si existe, no puede preceder a `serviceStartedAt`. La actividad se inserta con sus participantes y snapshots en una transacción. Errores: `403 TICKET_OUTSIDE_SUPPORT_AREA`; `404 TICKET_NOT_FOUND` / `PARTICIPANT_NOT_FOUND`; `409 TICKET_STATE_NOT_ALLOWED_FOR_ACTIVITY`, `PARTICIPANT_INACTIVE`, `INVALID_ACTIVITY_PARTICIPANT_ROLE`; `422 VALIDATION_ERROR`.

```ts
const activityLog = await api("/activity-log", {
  method: "POST",
  body: JSON.stringify({ ticketId, activity: "Diagnóstico y revisión de cableado.", participantIds: [technicianId],
    serviceStartedAt: new Date().toISOString(), serviceEndedAt: null, timeSpentMinutes: 90, status: "IN_PROGRESS" }),
});
```

### `GET /api/v1/activity-log/:id`

Roles: `SUPPORT`, `SUB_MANAGER`, `ADMIN`, con visibilidad por área. Devuelve ticket y snapshots, reportero histórico, actividad, participantes, fechas, tiempo, estado, creador y timestamps. Errores: `403 FORBIDDEN_ACTIVITY_LOG`, `404 ACTIVITY_LOG_NOT_FOUND`, `422 VALIDATION_ERROR`.

```ts
const entry = await api(`/activity-log/${activityId}`);
```

### `PATCH /api/v1/activity-log/:id`

Roles: `SUB_MANAGER` (dentro del área) y `ADMIN`. Body parcial estricto; solo permite `activity`, `participantIds`, `serviceStartedAt`, `serviceEndedAt`, `timeSpentMinutes`, `status`. No permite cambiar ticket ni snapshots. Se revalidan los valores combinados; cada cambio real crea revisión en la misma transacción. Un body que no cambia el estado devuelve el detalle actual sin revisión ni cambio de `updatedAt`. Errores: `403 FORBIDDEN_ACTIVITY_LOG`, `404 ACTIVITY_LOG_NOT_FOUND` / `PARTICIPANT_NOT_FOUND`, `409 PARTICIPANT_INACTIVE` / `INVALID_ACTIVITY_PARTICIPANT_ROLE`, `422 VALIDATION_ERROR`.

```ts
const updated = await api(`/activity-log/${activityId}`, {
  method: "PATCH",
  body: JSON.stringify({ activity: "Diagnóstico y sustitución de cableado.", timeSpentMinutes: 120 }),
});
```

### `GET /api/v1/activity-log/:id/history`

Solo `SUB_MANAGER` y `ADMIN`, con la misma visibilidad por área. Devuelve revisiones append-only en orden `createdAt ASC`, con `changedBy`, `previousData` y `newData` canónicos (incluidos `participantIds` ordenados). No existe API para crear, editar o eliminar revisiones. Errores: `403 FORBIDDEN_ACTIVITY_LOG`, `404 ACTIVITY_LOG_NOT_FOUND`, `422 VALIDATION_ERROR`.

```ts
const history = await api(`/activity-log/${activityId}/history`);
```

No existe `DELETE /api/v1/activity-log/:id`; las correcciones se realizan mediante PATCH y quedan auditadas.

## Inventario

Las seis operaciones requieren sesión y solo están disponibles para `SUB_MANAGER` y `ADMIN`. `USER` y `SUPPORT` reciben `403 FORBIDDEN`. Se serializan respuestas explícitas, sin devolver objetos Prisma ni relaciones no solicitadas.

| Campo | COMPUTER | PROJECTOR | CONTROL | ADAPTER |
|---|---|---|---|---|
| `model` | Requerido | Requerido | Requerido | Requerido |
| `assetCode` | Requerido | Requerido | Opcional / null | Opcional / null |
| `color` | Requerido | Requerido | Opcional / null | Opcional / null |
| `size` | Requerido | Requerido | Opcional / null | Opcional / null |
| `building` | Requerido | Opcional / null | Opcional / null | Opcional / null |
| `room` | Opcional / null | Opcional / null | Opcional / null | Opcional / null |
| `serialNumber` | Requerido | Opcional / null | Opcional / null | Opcional / null |
| `quantity` | 1 (opcional en request; default 1) | 1 (opcional en request; default 1) | Entero ≥ 1, requerido | Entero ≥ 1, requerido |
| `notes` | Opcional / null | Opcional / null | Opcional / null | Opcional / null |

Todos los strings se recortan; los opcionales vacíos se normalizan a `null`. Se preservan las mayúsculas/minúsculas de los identificadores visibles. El body POST es estricto: no acepta `id`, `isActive`, timestamps ni propiedades desconocidas. `type` es inmutable. PATCH admite únicamente `model`, `assetCode`, `color`, `size`, `building`, `room`, `serialNumber`, `quantity` y `notes`; valida el resultado combinado según el tipo existente. `isActive` no se puede editar mediante PATCH; para desactivar usa DELETE. Un PATCH idéntico devuelve `200` sin escritura.

### `GET /api/v1/inventory`

Query: `page` (1), `pageSize` (20, máximo 100), `search`, `type`, `building` y `active` (`true`/`false`). Si `active` se omite, vale `true`; para mostrar inactivos envía `active=false`. No existe filtro “todos”. `type` es uno de `COMPUTER`, `PROJECTOR`, `CONTROL`, `ADAPTER`. `building` compara sin distinguir mayúsculas; `search` busca sin distinguir mayúsculas en `model`, `assetCode`, `serialNumber`, `building` y `room`. Orden determinista: `createdAt DESC, id ASC`.

Respuesta: página estándar `{ success, data, meta }`. Cada elemento expone `id`, `type`, `model`, `assetCode`, `color`, `size`, `location: { building, room }`, `serialNumber`, `quantity`, `isActive` y `updatedAt` (no expone `notes` ni relaciones). `pageSize` fuera de 1–100, filtros desconocidos o enums inválidos responden `422 VALIDATION_ERROR`.

```ts
const response = await fetch(`${API_URL}/api/v1/inventory?page=1&pageSize=20&type=COMPUTER`, {
  credentials: "include",
});
const { data, meta } = await response.json();
```

### `POST /api/v1/inventory`

Body discriminado y estricto conforme a la tabla. Responde `201` con el detalle completo del artículo. `assetCode` y `serialNumber` son UNIQUE incluso después de desactivar el artículo; ante colisión real o concurrente responde respectivamente `409 INVENTORY_ASSET_CODE_ALREADY_EXISTS` o `409 INVENTORY_SERIAL_NUMBER_ALREADY_EXISTS`. La base de datos es la barrera final; no se confía en prechecks.

```ts
await api("/inventory", {
  method: "POST",
  body: JSON.stringify({
    type: "COMPUTER", model: "Dell OptiPlex 7090", assetCode: "PAT-00421",
    color: "Negro", size: "SFF", building: "Edificio 6", room: "603",
    serialNumber: "DX92K1", quantity: 1, notes: null,
  }),
});
```

### `GET /api/v1/inventory/:id`

Devuelve el detalle aun si el artículo está inactivo: campos de inventario (`type`, texto, cantidad, `notes`, `isActive`) y `createdAt`/`updatedAt`. UUID inválido: `422 VALIDATION_ERROR`; inexistente: `404 INVENTORY_ITEM_NOT_FOUND`.

### `PATCH /api/v1/inventory/:id`

Body parcial de campos editables. El tipo no cambia y no existe reactivación mediante PATCH. El registro se bloquea al leer, combinar, validar sus requisitos y guardar, para no validar contra un estado obsoleto. Los errores de unicidad conservan sus códigos de dominio; UUID inválido es `422`, y artículo inexistente `404 INVENTORY_ITEM_NOT_FOUND`.

```ts
await api(`/inventory/${inventoryId}`, {
  method: "PATCH",
  body: JSON.stringify({ room: "604", notes: "Reubicado" }),
});
```

### `DELETE /api/v1/inventory/:id`

Soft delete idempotente: establece `isActive=false`, responde `204` incluso si ya estaba inactivo y conserva valores únicos, referencias y tickets. No hay hard delete.

### `GET /api/v1/inventory/:id/tickets`

Historial paginado de tickets asociados; funciona para artículos activos e inactivos. Query: `page` (1), `pageSize` (20, máximo 100), `status` (`OPEN`, `IN_REVIEW`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`), `from` y `to`. Las fechas filtran `Ticket.createdAt`; admiten ISO DateTime con zona o fecha `YYYY-MM-DD` (UTC, inclusiva durante el día). `from > to` responde `422`. Orden: `createdAt DESC, id ASC`. El elemento expone código, título, categoría/subcategoría, prioridad, estado, `reporter: { fullName }`, `createdAt` y `completedAt`; el nombre siempre procede de `Ticket.reporterNameSnapshot`, nunca del User actual. Un artículo existente sin tickets devuelve `200` con `data: []` y `totalPages: 0`. Artículo inexistente: `404 INVENTORY_ITEM_NOT_FOUND`.

```ts
const tickets = await api(`/inventory/${inventoryId}/tickets?page=1&pageSize=20`);
```

Todas las rutas documentan `401` por sesión faltante, `403` por rol y `422 VALIDATION_ERROR` por entradas inválidas, además de los errores específicos indicados arriba.

## Miembros de soporte

Las cinco rutas `/api/v1/support-members` requieren sesión de `ADMIN`; `USER`, `SUPPORT` y `SUB_MANAGER` reciben `403`. Se reutiliza `User` con roles `SUPPORT`/`SUB_MANAGER`; no hay contraseña ni invitación por correo. Un miembro se crea antes del primer acceso Google (`googleSubject=null`), y OAuth lo vincula por email sin cambiar rol, comunidad, áreas, habilidades ni identificador institucional. Las respuestas nunca incluyen `googleSubject`, teléfono ni avatar; `googleLinked` indica si ya existe vínculo.

### `GET /api/v1/support-members`

Filtros opcionales: `search` (case-insensitive en nombre, email e identificador), `role` (`SUPPORT` o `SUB_MANAGER`), `supportArea` (`HARDWARE`, `SOFTWARE`, `NETWORKS`, `ADMINISTRATIVE`) y `active` (`true` por defecto, o `false`). Paginación estándar: `page=1`, `pageSize=20`, máximo 100; orden `fullName ASC, id ASC`. Un filtro inválido responde `422 VALIDATION_ERROR`. Para poblar el selector administrativo de asignación usa `?supportArea=HARDWARE&active=true`; la asignación vuelve a comprobar en servidor rol, actividad y área.

Respuesta `{ success: true, data: [...], meta: { page, pageSize, total, totalPages } }`. Cada elemento contiene `id`, `fullName`, `email`, `institutionalId`, `communityType`, `role`, `supportAreas`, `skills`, `isActive`, `googleLinked` y `lastLoginAt` (nullable).

### `POST /api/v1/support-members`

Body estricto: exactamente los campos `fullName`, `email`, `institutionalId`, `communityType`, `role`, `supportAreas` y `skills`. `fullName` e `institutionalId` se recortan y no pueden estar vacíos; el identificador admite letras y números. `email` se normaliza a minúsculas y debe pertenecer a `ALLOWED_EMAIL_DOMAINS` (si no, `403 EMAIL_DOMAIN_NOT_ALLOWED`). El rol solo puede ser `SUPPORT` o `SUB_MANAGER`; áreas no vacías y sin duplicados; habilidades pueden ser `[]`, se recortan y no aceptan vacías ni duplicados sin distinguir mayúsculas. `USER`/`ADMIN` o campos adicionales responden `422`. La respuesta `201` usa el detalle e incluye `createdAt`/`updatedAt`.

```json
{
  "fullName": "Ana Soporte",
  "email": "ana@uabc.edu.mx",
  "institutionalId": "EMP-A42",
  "communityType": "ADMINISTRATIVE",
  "role": "SUPPORT",
  "supportAreas": ["HARDWARE"],
  "skills": ["Proyectores"]
}
```

La unicidad de email e institutionalId se resuelve finalmente con los constraints PostgreSQL, también bajo POST concurrentes. Los conflictos devuelven `409 EMAIL_ALREADY_REGISTERED` o `409 INSTITUTIONAL_ID_ALREADY_REGISTERED`. No se envía email ni se escribe NotificationOutbox.

### `GET /api/v1/support-members/:id`

Devuelve el detalle también cuando `isActive=false`. UUID inválido: `422`; id inexistente o que corresponde a `USER`/`ADMIN`: `404 SUPPORT_MEMBER_NOT_FOUND`.

### `PATCH /api/v1/support-members/:id`

Admite parcialmente solo `fullName`, `role`, `supportAreas`, `skills`, `isActive`. Permite `SUPPORT` ↔ `SUB_MANAGER`, baja y reactivación. Un miembro activo debe conservar al menos un área; un PATCH vacío o idéntico devuelve `200` sin modificar `updatedAt`. No se puede alterar email, institutionalId, communityType o vínculo Google. La desactivación con tickets asignados `OPEN`, `IN_REVIEW` o `IN_PROGRESS` devuelve `409 SUPPORT_MEMBER_HAS_ACTIVE_TICKETS`.

### `DELETE /api/v1/support-members/:id`

Baja lógica (`isActive=false`) idempotente: `204` sin body incluso cuando ya estaba inactivo. Conserva User, vínculo Google, tickets, eventos y bitácoras. Si tiene tickets activos asignados, devuelve `409 SUPPORT_MEMBER_HAS_ACTIVE_TICKETS`; reasígnalos o desasígnalos antes. La asignación y la baja bloquean la misma fila de User en PostgreSQL para no dejar un ticket recién asignado a un miembro inactivo. Tras la baja, su sesión anterior y nuevos intentos OAuth reciben `403 USER_DISABLED`. No hay hard delete.

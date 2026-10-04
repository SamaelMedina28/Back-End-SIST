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

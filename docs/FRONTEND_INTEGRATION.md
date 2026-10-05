# Integración inicial del frontend

## URL base

Configura en el frontend:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

La API funcional usa el prefijo `/api/v1`.

## Iniciar sesión con Google

```ts
export function loginWithGoogle(): void {
  window.location.href =
    `${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/google`;
}
```

El navegador sigue la redirección a Google y vuelve al backend. No se transportan JWT ni tokens Google en JavaScript.

## Consultar la sesión

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function getCurrentUser() {
  const response = await fetch(
    `${API_URL}/api/v1/auth/me`,
    {
      credentials: "include",
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message ?? "No fue posible consultar la sesión.");
  }

  const json = await response.json();
  return json.data;
}
```

Todas las peticiones protegidas deben incluir:

```ts
credentials: "include"
```

El backend restringe CORS a `FRONTEND_URL` y permite credenciales.

## Usuario existente

```text
/auth/success
→ el frontend llama GET /api/v1/auth/me
→ recibe el User actual
→ redirige al dashboard correspondiente
```

## Usuario nuevo

```text
/auth/complete-profile
→ el frontend muestra institutionalId, communityType y phone opcional
→ POST /api/v1/auth/complete-profile con credentials: include
→ el backend crea User y sesión
→ el frontend redirige al dashboard
```

Ejemplo:

```ts
await fetch(
  `${API_URL}/api/v1/auth/complete-profile`,
  {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      institutionalId: "1287456",
      communityType: "STUDENT",
      phone: null,
    }),
  },
);
```

No envíes email, nombre, role, supportAreas, skills, avatarUrl ni googleSubject.

## Actualizar perfil

```ts
await fetch(
  `${API_URL}/api/v1/users/me`,
  {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fullName: "Nombre completo",
      phone: "6641234567",
    }),
  },
);
```

## Logout

```ts
await fetch(
  `${API_URL}/api/v1/auth/logout`,
  {
    method: "POST",
    credentials: "include",
  },
);
```

La respuesta es `204 No Content`.

## Helper de API

Usa una función común que envíe cookies de sesión y extraiga el campo `data`:

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (response.status === 204) return undefined as T;
  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.message ?? "Error desconocido");
  return json.data as T;
}
```

## Cargar el formulario de ticket

```ts
const catalog = await api<{
  categories: Array<{
    id: string;
    code: string;
    name: string;
    supportArea: string;
    defaultPriority: "LOW" | "MEDIUM" | "HIGH" | null;
    requiresSoftwareDetails: boolean;
    subcategories: Array<{
      id: string;
      code: string;
      name: string;
      priority: "LOW" | "MEDIUM" | "HIGH" | null;
    }>;
  }>;
  maxActiveTickets: 10;
}>("/catalog/ticket-form");
```

## Consultar categorías

```ts
const categories = await api<Array<{
  id: string;
  code: string;
  name: string;
  supportArea: string;
  defaultPriority: "LOW" | "MEDIUM" | "HIGH" | null;
  isActive: boolean;
  subcategories: Array<{ id: string; code: string; name: string; priority: string | null; isActive: boolean }>;
}>>("/categories");
```

Solo una cuenta ADMIN puede usar `?includeInactive=true` o modificar el catálogo.

## Sugerencias de soporte

```ts
const query = new URLSearchParams({ categoryId, subcategoryId });
const suggestions = await api<Array<{ id: string; title: string; description: string }>>(
  `/catalog/support-suggestions?${query}`,
);
```

`subcategoryId` es opcional. La respuesta puede ser `[]` mientras no se cargue contenido activo; no hay sugerencias de demostración.

## Crear una categoría (ADMIN)

```ts
await api("/categories", {
  method: "POST",
  body: JSON.stringify({
    code: "NEW_CATEGORY",
    name: "Nueva categoría",
    supportArea: "HARDWARE",
    defaultPriority: "MEDIUM",
    requiresSoftwareDetails: false,
  }),
});
```

Los usuarios comunes solo consultan categorías y catálogo. Las solicitudes de escritura para otras cuentas responden `403 FORBIDDEN`.

La documentación interactiva está disponible en `/api/docs` y el documento OpenAPI en `/api/openapi.json`.

## Crear y consultar tickets

El formulario debe cargar `/catalog/ticket-form` antes de mostrar categorías. Solo cuentas con rol `USER` pueden crear tickets. Envía solo los campos aceptados; `reporterId`, `priority`, `status`, `code` y snapshots son responsabilidad del backend. La subcategoría es obligatoria si la categoría seleccionada tiene subcategorías activas. Una prioridad efectiva null impide crear el ticket hasta que ADMIN configure el catálogo.

```ts
const ticket = await api<{ id: string; code: string }>("/tickets", {
  method: "POST",
  body: JSON.stringify({
    title: "Proyector sin señal",
    categoryId,
    subcategoryId,
    building: "Edificio 6",
    room: "603",
    description: "El proyector enciende pero no muestra señal.",
    contactPhone: null,
    inventoryItemId: null,
  }),
});
```

Para una categoría con `requiresSoftwareDetails: true`, muestra los cuatro campos de software y permite enviar el formulario solo a cuentas `communityType: "TEACHER"`:

```ts
const software = {
  name: "AutoCAD",
  version: "2027",
  downloadUrl: "https://example.com/autocad",
  coordinationApprovalReference: "OFICIO-FCQI-2026-184",
};
```

Para listar, el helper `api` anterior devuelve solo `data`. Si necesitas paginación, conserva también `meta` leyendo el envelope:

```ts
const response = await fetch(`${API_URL}/api/v1/tickets?page=1&pageSize=20&status=OPEN`, {
  credentials: "include",
});
const envelope = await response.json();
if (!response.ok) throw new Error(envelope.error?.message ?? "No fue posible listar tickets.");
const tickets = envelope.data;
const { page, pageSize, total, totalPages } = envelope.meta;
```

`USER` ve solo sus tickets. `SUPPORT` y `SUB_MANAGER` ven los tickets de sus áreas, incluso si otro usuario los reportó. `ADMIN` ve todos. Los filtros `assignment` (`mine`, `unassigned`, `assigned`), `assignedTo` y `supportArea` no están disponibles para `USER`. El filtro de área de un miembro de soporte debe ser una de sus áreas. Las fechas `createdFrom` y `createdTo` son instantes ISO inclusivos; `pageSize` no debe superar 100.

```ts
const detail = await api(`/tickets/${ticketId}`);
const events = await api(`/tickets/${ticketId}/events`);
```

## Asignación, estado y prioridad

`SUPPORT`/`SUB_MANAGER` puede autoasignarse con `POST /api/v1/tickets/:id/assign-self`; `ADMIN` asigna/reasigna con `PUT /api/v1/tickets/:id/assignee` y retira asignación con `DELETE` en esa misma ruta. Solo se muestran acciones para tickets activos; el servidor vuelve a validar rol, área y estado de manera atómica.

Una asignación exitosa encola el correo al nuevo técnico junto con el cambio y el evento. La respuesta HTTP no espera al SMTP; si recibe `200`, actualiza la UI como asignado. No llames otra ruta para correo ni repitas la asignación por una posible demora del email. La falla SMTP se reintenta en backend sin revertir la asignación.

```ts
await api(`/tickets/${ticketId}/assignee`, {
  method: "PUT",
  body: JSON.stringify({ assigneeId: technicianId }),
});
```

Para cambiar el estado, ofrece únicamente las transiciones válidas: `OPEN → IN_REVIEW/IN_PROGRESS`, `IN_REVIEW → IN_PROGRESS` e `IN_PROGRESS → COMPLETED`; desde cada estado activo también se puede cancelar. `CANCELLED` requiere una nota (1–500 caracteres). `SUPPORT` y `SUB_MANAGER` solo pueden cambiar tickets asignados a sí mismos en sus áreas; `ADMIN` puede hacerlo en cualquier área.

Genera una clave de idempotencia por intento lógico de cambio de estado y conserva exactamente la misma clave y body ante reintentos de red. No reutilices la clave para una transición o nota distinta. El backend guarda respuestas durante 24 horas; un body distinto con la misma clave produce `409 IDEMPOTENCY_CONFLICT`.

```ts
const idempotencyKey = crypto.randomUUID();
const response = await fetch(`${API_URL}/api/v1/tickets/${ticketId}/status`, {
  method: "PATCH",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  },
  body: JSON.stringify({ status: "IN_PROGRESS", note: "Diagnóstico iniciado" }),
});
const result = await response.json();
if (!response.ok) throw new ApiError(result.error.code, result.error.message, result.error.fields);
```

`ADMIN` cambia prioridad con `PATCH /api/v1/tickets/:id/priority`, body `{ priority, reason }`; la razón es obligatoria. Los tickets `COMPLETED` y `CANCELLED` son terminales y no admiten cambios de estado, asignación ni prioridad.

En el detalle, el nombre, correo y teléfono del reportero son snapshots del momento en que creó el ticket. El timeline empieza con un evento `CREATED` y llega ordenado de antiguo a nuevo.

Para mostrar acciones útiles según el código de error, adapta el helper a conservar `error.code` además de `message`:

```ts
class ApiError extends Error {
  constructor(public code: string, message: string, public fields?: Record<string, string[]>) {
    super(message);
  }
}

// Dentro del helper, después de await response.json():
if (!response.ok) {
  throw new ApiError(json.error?.code ?? "UNKNOWN_ERROR", json.error?.message ?? "Error desconocido", json.error?.fields);
}
```

- `409 DUPLICATE_TICKET`: muestra que ya existe una incidencia activa para la misma categoría y ubicación; la subcategoría distinta no evita el duplicado.
- `409 ACTIVE_TICKET_LIMIT_REACHED`: indica que el usuario alcanzó diez tickets activos.
- `409 TICKET_PRIORITY_NOT_CONFIGURED`: pide elegir otra categoría o avisar a ADMIN para configurarla.
- `422 VALIDATION_ERROR`: presenta `error.fields` junto a los campos del formulario; la descripción admite máximo 50 palabras.

## Bitácora de servicio (D10/D11)

Permisos: `SUPPORT` consulta; `SUB_MANAGER` consulta, registra y modifica dentro de sus áreas; `ADMIN` consulta, registra y modifica todas las áreas. `USER` recibe 403. No hay eliminación de entradas. El historial solo está disponible para `SUB_MANAGER` y `ADMIN`.

El formulario de D11 envía ticket, actividad, participantes, inicio, fin opcional, tiempo efectivo y estado. No envíes los snapshots ni el creador. El ticket debe estar `IN_PROGRESS` o `COMPLETED`; una actividad solo admite `IN_PROGRESS` o `COMPLETED`. Para COMPLETED exige fecha final. Los minutos representan dedicación efectiva y no se calculan a partir del intervalo.

Para poblar el selector de participantes de un ticket, `SUB_MANAGER` y `ADMIN` consultan el catálogo contextual. El servidor deriva el área desde el ticket y solo permite a `SUB_MANAGER` consultar tickets de sus áreas. Devuelve `id`, `fullName` y `role` de usuarios activos con rol permitido. `SUPPORT` es de solo lectura y `USER` no tiene acceso. No uses `/support-members` para este selector: sigue siendo `ADMIN`-only. Aunque el selector use este catálogo, el POST vuelve a validar cada `participantId` y exige una lista no vacía.

```ts
const { data: candidates } = await api(`/catalog/activity-log-participants?ticketId=${ticketId}`);
// [{ id, fullName, role }]
```

```ts
const response = await fetch(`${API_URL}/api/v1/activity-log?page=1&pageSize=20`, {
  credentials: "include",
});
const envelope = await response.json();
if (!response.ok) throw new ApiError(envelope.error.code, envelope.error.message, envelope.error.fields);
const { data, meta } = envelope;
```

```ts
await api("/activity-log", {
  method: "POST",
  body: JSON.stringify({
    ticketId,
    activity: "Diagnóstico y revisión de cableado.",
    participantIds: [technicianId],
    serviceStartedAt: new Date().toISOString(),
    serviceEndedAt: null,
    timeSpentMinutes: 90,
    status: "IN_PROGRESS",
  }),
});
```

Para filtrar D10, usa los query params `ticketId`, `technicianId` (participante, no creador), `status`, `search`, `from`, `to`, `page` y `pageSize`. `search` incluye código, título, falla, reportero snapshot y texto de actividad. `from/to` se aplican a `serviceStartedAt`; una fecha `YYYY-MM-DD` en `to` incluye el día UTC completo.

```ts
await api(`/activity-log/${activityId}`);

await api(`/activity-log/${activityId}`, {
  method: "PATCH",
  body: JSON.stringify({
    activity: "Diagnóstico y sustitución de cableado.",
    timeSpentMinutes: 120,
  }),
});

const history = await api(`/activity-log/${activityId}/history`);
```

La respuesta incluye ticket, falla y datos del reportero desde snapshots históricos, participantes, fechas, minutos, estado y creador. Cada PATCH que cambia datos genera una revisión inmutable; PATCH sin cambios no genera auditoría. No sincronices snapshots si luego cambia el ticket: cada entrada conserva el contexto con el que se registró.

## Inventario (D12)

Las rutas de inventario requieren rol `SUB_MANAGER` o `ADMIN`. `USER` y `SUPPORT` reciben `403`. La lista es paginada y por defecto muestra solo activos; `active=false` solicita inactivos. Los tipos válidos son `COMPUTER`, `PROJECTOR`, `CONTROL` y `ADAPTER`.

Campos requeridos al crear:

- `COMPUTER`: `model`, `assetCode`, `color`, `size`, `building`, `serialNumber`; `room` y `notes` opcionales/null; `quantity` se omite o vale `1`.
- `PROJECTOR`: `model`, `assetCode`, `color`, `size`; `building`, `room`, `serialNumber` y `notes` opcionales/null; `quantity` se omite o vale `1`.
- `CONTROL` / `ADAPTER`: `model` y `quantity` (entero ≥ 1); los demás campos son opcionales/null.

Los strings se recortan y los opcionales vacíos se envían/guardan como `null`. No envíes IDs, `isActive`, timestamps ni `type` en PATCH. El tipo no puede cambiarse y PATCH no reactiva. `assetCode` y `serialNumber` no se liberan al desactivar, porque permanecen únicos por historia.

Listar con filtros y paginación:

```ts
const response = await fetch(
  `${API_URL}/api/v1/inventory?page=1&pageSize=20&type=COMPUTER&search=optiplex&building=Edificio%206&active=true`,
  { credentials: "include" },
);
const envelope = await response.json();
if (!response.ok) throw new ApiError(envelope.error.code, envelope.error.message, envelope.error.fields);
const { data, meta } = envelope;
```

Crear un equipo:

```ts
await api("/inventory", {
  method: "POST",
  body: JSON.stringify({
    type: "COMPUTER",
    model: "Dell OptiPlex 7090",
    assetCode: "PAT-00421",
    color: "Negro",
    size: "SFF",
    building: "Edificio 6",
    room: "603",
    serialNumber: "DX92K1",
    quantity: 1,
    notes: null,
  }),
});
```

Editar, desactivar y consultar incidencias anteriores:

```ts
await api(`/inventory/${inventoryId}`, {
  method: "PATCH",
  body: JSON.stringify({ room: "604", notes: "Reubicado" }),
});

await api(`/inventory/${inventoryId}`, { method: "DELETE" });

const response = await fetch(
  `${API_URL}/api/v1/inventory/${inventoryId}/tickets?page=1&pageSize=20`,
  { credentials: "include" },
);
const envelope = await response.json();
if (!response.ok) throw new ApiError(envelope.error.code, envelope.error.message, envelope.error.fields);
const { data: tickets, meta } = envelope;
```

El historial admite `status`, `from` y `to` además de paginación. `from/to` filtran la fecha de creación del ticket. `reporter.fullName` es un snapshot del ticket y no cambia cuando se actualiza el usuario. El detalle directo y el historial siguen disponibles después de desactivar el artículo; los tickets previos conservan su relación. Un ticket nuevo que intente usar un artículo inactivo sigue recibiendo `409 INVENTORY_ITEM_INACTIVE`.

## Gestión de miembros de soporte (ADMIN)

La pantalla administrativa usa las cinco rutas `/api/v1/support-members` con `credentials: "include"`. Solo `ADMIN` puede acceder. `GET` devuelve `{ success, data, meta }` paginado (`page=1`, `pageSize=20`, máximo 100), activo por defecto y ordenado por `fullName ASC, id ASC`. Filtros: `search`, `role=SUPPORT|SUB_MANAGER`, `supportArea` y `active=true|false`.

```ts
const { data: candidates, meta } = await api(
  "/support-members?supportArea=HARDWARE&active=true&page=1&pageSize=20",
);
// Mostrar candidates en el selector de asignación; conservar meta para más páginas.
```

Este filtro ofrece candidatos compatibles, pero `PUT /tickets/:id/assignee` vuelve a validar rol, actividad y área: maneja `409 ASSIGNEE_INACTIVE` y `409 ASSIGNEE_AREA_MISMATCH` si cambiaron mientras estaba abierta la pantalla. La lista incluye `googleLinked`, no `googleSubject`.

Para preaprovisionar, envía `fullName`, `email`, `institutionalId`, `communityType`, `role`, `supportAreas` y `skills`:

```ts
const created = await api("/support-members", {
  method: "POST",
  body: JSON.stringify({
    fullName: "Ana Soporte",
    email: "ana@uabc.edu.mx",
    institutionalId: "EMP-A42",
    communityType: "ADMINISTRATIVE",
    role: "SUPPORT",
    supportAreas: ["HARDWARE"],
    skills: ["Proyectores"],
  }),
});
```

La creación responde `201`; `googleLinked=false` y `lastLoginAt=null`. No se envía invitación. La persona inicia sesión después con Google usando exactamente ese correo institucional; OAuth encuentra el User por email, vincula el `sub` y conserva rol, áreas y habilidades. Si el correo no pertenece a los dominios permitidos, maneja `403 EMAIL_DOMAIN_NOT_ALLOWED`. Si el email o el identificador ya existe, maneja `409 EMAIL_ALREADY_REGISTERED` o `409 INSTITUTIONAL_ID_ALREADY_REGISTERED`. Para mostrar detalles, consulta `GET /support-members/:id`, que también funciona si está inactivo.

```ts
await api(`/support-members/${memberId}`, {
  method: "PATCH",
  body: JSON.stringify({ role: "SUB_MANAGER", supportAreas: ["HARDWARE", "NETWORKS"] }),
});
await api(`/support-members/${memberId}`, { method: "DELETE" }); // 204, sin JSON
```

PATCH solo acepta `fullName`, `role`, `supportAreas`, `skills`, `isActive`; `isActive: true` reactiva sin crear otra cuenta. El miembro activo requiere al menos un área. DELETE baja lógicamente y puede repetirse; si hay tickets `OPEN`, `IN_REVIEW` o `IN_PROGRESS` asignados, PATCH de baja y DELETE devuelven `409 SUPPORT_MEMBER_HAS_ACTIVE_TICKETS`. Solicita reasignación/desasignación antes de reintentar. La baja conserva historial e identidad Google, pero invalida la sesión para endpoints protegidos y bloquea nuevos accesos OAuth (`403 USER_DISABLED`).

## Reporte de actividad para ADMIN

Con sesión ADMIN, construye el query con fechas locales `YYYY-MM-DD` y conserva esos valores en la UI: la respuesta congelada no repite `period` ni `filters`. Todos los filtros son opcionales y combinables; `technicianId` refiere al asignado actual/final, no al creador del ticket.

```ts
const params = new URLSearchParams({ from: "2026-09-01", to: "2026-09-30" });
if (supportArea) params.set("supportArea", supportArea);
if (categoryId) params.set("categoryId", categoryId);
if (technicianId) params.set("technicianId", technicianId);
const report = await api<{
  summary: { ticketsCreated: number; ticketsCompleted: number; pending: number; averageResolutionMinutes: number };
  byCategory: Array<{ categoryId: string; category: string; count: number }>;
  byTechnician: Array<{ technicianId: string; name: string; completed: number; active: number }>;
  daily: Array<{ date: string; created: number; completed: number }>;
}>(`/reports/activity?${params}`);
```

`daily` está ordenado y contiene todos los días del rango, incluidos los que tienen cero; usa `date` como etiqueta de gráfica sin convertirla a un instante UTC del navegador. Creaciones y resoluciones son series distintas: un ticket puede terminar en el periodo aunque se haya creado antes. `pending` refleja el estado **actual** de los creados en el rango. El promedio es cero si no hubo resoluciones. `byTechnician` puede incluir técnicos hoy inactivos. Maneja `401` redirigiendo al acceso, `403` ocultando la pantalla a no administradores y `422 VALIDATION_ERROR` mostrando errores de fecha/filtros. El frontend dibuja las gráficas; el backend solo entrega JSON.

Para D16, usa `daily` en líneas/barras, `byCategory` en gráfica por categorías y `byTechnician` en tabla o gráfica de productividad/carga. Los nombres de categorías y técnicos son actuales, no snapshots históricos. No hay exportación en esta etapa.

## Inicio / dashboard por rol (D02, D07 y D13)

Consulta siempre la misma ruta autenticada, sin enviar un rol en query:

```ts
const user = await api<{ role: "USER" | "SUPPORT" | "SUB_MANAGER" | "ADMIN" }>("/auth/me");
const dashboard = await api("/dashboard");
if (user.role === "USER") renderUserDashboard(dashboard);
else if (user.role === "SUPPORT" || user.role === "SUB_MANAGER") renderSupportDashboard(dashboard);
else renderAdminDashboard(dashboard);
```

El backend consulta el rol actual desde la sesión. `USER` recibe `stats: { active, inProgress, completed }` de sus reportes y `recentTickets` (máximo cinco). `SUPPORT` y `SUB_MANAGER` reciben `stats: { unassigned, mine, highPriority, completedToday }` y `priorityTickets` (máximo diez), siempre limitados a sus áreas; `mine` son activos asignados a sí mismos. Ambas listas usan la forma de los elementos de `GET /tickets`. `ADMIN` recibe `stats: { activeTickets, unassigned, activeTechnicians, inventoryItems }` globales y `technicianWorkload`, que incluye técnicos activos aunque tengan carga cero. `activeTechnicians` no cuenta usuarios ordinarios ni ADMIN; `inventoryItems` excluye inventario inactivo.

`completedToday` corresponde al día institucional configurado en `APP_TIMEZONE` (por defecto `America/Tijuana`), no a la fecha UTC del navegador. El frontend puede refrescar `GET /dashboard` después de acciones relevantes; no necesita endpoints separados, polling especial ni caché adicional. Sin sesión, maneja `401 AUTHENTICATION_REQUIRED` y dirige al acceso.

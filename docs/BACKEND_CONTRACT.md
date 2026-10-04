# Contrato del backend — Sistema Integral de Soporte Técnico de la FCQI - UABC

> Fuente de verdad para el desarrollo del backend. Esta etapa documenta el contrato y el diagnóstico del repositorio; no implementa todavía el sistema completo.
>
> El contenido normativo recibido se conserva a continuación, con formato Markdown para facilitar su consulta. Las discrepancias detectadas durante el análisis aparecen al final y no modifican silenciosamente este contrato.

Trabaja sobre ESTE repositorio actual: CLI-para-express.

Antes de implementar funcionalidades, analiza el proyecto existente completo y crea el archivo:

docs/BACKEND_CONTRACT.md

Este archivo será la FUENTE DE VERDAD del backend durante todo el desarrollo.

IMPORTANTE:
- Todas las etapas futuras deberán respetar este contrato.
- No cambies nombres de rutas, campos, enums ni formatos de respuesta sin indicarlo.
- Si detectas que algo del contrato es técnicamente imposible o inconsistente, NO lo cambies silenciosamente. Repórtalo.
- No implementes todavía todos los endpoints. En esta etapa principalmente debes documentar el contrato y preparar la estructura mínima necesaria.
- Conserva la filosofía modular existente de CLI-para-express.
- Stack obligatorio:
  - Node.js
  - Express 5
  - TypeScript
  - Prisma 7
  - PostgreSQL
  - Zod
  - pnpm
- El frontend será independiente, probablemente Next.js.
- La comunicación será mediante API REST.
- La autenticación debe ser manejada por Express utilizando Google OAuth. NO usar NextAuth.
- Prisma debe seguir utilizando PostgreSQL.
- Debe utilizarse la estructura modular existente siempre que sea razonable.

## 1. BASE DE LA API

Todas las rutas funcionales estarán bajo:

/api/v1

Por ejemplo:

GET /api/v1/tickets
POST /api/v1/tickets

Rutas fuera de /api/v1:

GET /health
GET /ready
GET /api/docs
GET /api/openapi.json

## 2. FORMATO ESTÁNDAR DE RESPUESTAS

Respuesta exitosa:

{
  "success": true,
  "data": {}
}

Respuesta de listado:

{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "totalPages": 5
  }
}

Respuesta de error:

{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Mensaje entendible para el usuario",
    "fields": {
      "campo": [
        "Descripción del error"
      ]
    }
  },
  "requestId": "req_xxx"
}

"fields" es opcional y se utiliza principalmente para errores de validación.

Nunca devolver:
- stack traces al cliente;
- mensajes internos de Prisma;
- secretos;
- JWT;
- errores técnicos sin transformar.

## 3. CÓDIGOS HTTP

200 OK
201 Created
204 No Content

400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity
429 Too Many Requests
500 Internal Server Error
503 Service Unavailable

## 4. ENUMS

Role:

### USER
### SUPPORT
SUB_MANAGER
### ADMIN

CommunityType:

### STUDENT
### TEACHER
### ADMINISTRATIVE

SupportArea:

### HARDWARE
### SOFTWARE
### NETWORKS
### ADMINISTRATIVE

TicketPriority:

### LOW
### MEDIUM
### HIGH

TicketStatus:

### OPEN
IN_REVIEW
IN_PROGRESS
### COMPLETED
### CANCELLED

InventoryType:

### COMPUTER
### PROJECTOR
### CONTROL
### ADAPTER

TicketEventType:

### CREATED
### ASSIGNED
### UNASSIGNED
STATUS_CHANGED
PRIORITY_CHANGED
### CANCELLED

NotificationStatus:

### PENDING
### SENT
### FAILED

## 5. MODELO USER

Debe contemplar al menos:

id: UUID
googleSubject: string | null, unique
email: string, unique
institutionalId: string, unique
fullName: string
phone: string | null
role: Role
communityType: CommunityType
supportAreas: SupportArea[]
skills: string[]
avatarUrl: string | null
isActive: boolean
lastLoginAt: DateTime | null
createdAt: DateTime
updatedAt: DateTime

NO debe existir password.

Un alumno, docente o administrativo común tendrá:

role = USER

communityType determina si es:

### STUDENT
### TEACHER
### ADMINISTRATIVE

Ejemplo:

{
  "id": "uuid",
  "email": "usuario@uabc.edu.mx",
  "institutionalId": "1287456",
  "fullName": "Aziel Medina",
  "phone": null,
  "role": "USER",
  "communityType": "STUDENT",
  "supportAreas": [],
  "skills": [],
  "avatarUrl": null,
  "isActive": true
}

## 6. CATEGORÍAS

Category:

id
code
name
supportArea
defaultPriority
isActive
requiresSoftwareDetails
createdAt
updatedAt

Subcategory:

id
categoryId
code
name
priority
isActive
createdAt
updatedAt

La prioridad de una subcategoría tiene precedencia sobre la defaultPriority de Category.

Si Subcategory.priority es null, utilizar Category.defaultPriority.

Categorías iniciales:

EQUIPMENT_FAILURE
Nombre: Falla de equipo
Área: HARDWARE

Subcategorías:

DATE_TIME_RESET
"Reinicio de fecha y hora"
### MEDIUM

SYSTEM_INOPERABLE
"Sistema inoperable"
### HIGH

BOOT_LOOP
"Arranque perpetuo"
### HIGH

NETWORK_CONNECTIVITY
"Falla de conectividad a la red"
### MEDIUM

MISSING_PERIPHERALS
"Falta de periféricos para su operación"
### LOW

### OTHER
"Otros"
prioridad configurable

MONITOR_FAILURE
"Falla de monitor"
### HARDWARE

TOTAL_FAILURE
"Falla total"
### MEDIUM

PARTIAL_FAILURE
"Falla parcial"
### LOW

PROJECTOR_FAILURE
"Falla de proyector"
### HARDWARE

### OVERHEATING
"Apagado por sobrecalentamiento"
### HIGH

CONNECTION_FAILURE
"Falla de conexión"
### HIGH

BLURRY_IMAGE
"Imagen borrosa o con tinte"
### LOW

TOTAL_FAILURE
"Falla total"
### HIGH

SOFTWARE_INSTALLATION
"Instalación de software"
### SOFTWARE
### HIGH

PRINTER_INSTALLATION
"Instalación de impresora"
### HARDWARE
### HIGH

PRINTER_FAILURE
"Falla de impresora"
### HARDWARE

CANNOT_PRINT
"Incapacidad de impresión"
### HIGH

### OTHER
"Otros"
prioridad configurable

ELECTRICAL_CABLING_FAILURE
"Falla de extensión o cableado eléctrico"
### HARDWARE
prioridad configurable

PREVENTIVE_MAINTENANCE
"Mantenimiento preventivo a las máquinas"
### HARDWARE
### LOW

EXAM_PREPARATION
"Preparación para exámenes colegiados"
### ADMINISTRATIVE
### HIGH

### OTHER
"Otros"
### ADMINISTRATIVE
prioridad configurable

## 7. MODELO TICKET

Ticket deberá soportar conceptualmente:

id: UUID
number: número autoincremental interno
code: identificador legible como TK-001045

title
description

reporterId

Snapshots históricos:
reporterNameSnapshot
reporterEmailSnapshot
reporterPhoneSnapshot
reporterCommunityTypeSnapshot

categoryId
subcategoryId

priority
status

building
room

inventoryItemId

assigneeId
assignedAt

softwareName
softwareVersion
softwareDownloadUrl
coordinationApprovalReference

duplicateKey

completedAt
cancelledAt
cancellationReason

createdAt
updatedAt

El cliente NO puede decidir:

reporterId
reporterNameSnapshot
reporterEmailSnapshot
reporterCommunityTypeSnapshot
priority
status
assigneeId
assignedAt
code
number
createdAt
updatedAt
duplicateKey

Todo eso lo determina el backend.

## 8. CREACIÓN DE TICKET

POST /api/v1/tickets

Autenticación:
Sí.

Rol principal:
### USER

Request normal:

{
  "title": "Proyector sin señal",
  "categoryId": "uuid",
  "subcategoryId": "uuid",
  "building": "Edificio 6",
  "room": "603",
  "description": "El proyector enciende pero no muestra señal.",
  "contactPhone": null,
  "inventoryItemId": null
}

Campos:

title:
string obligatorio

categoryId:
UUID obligatorio

subcategoryId:
UUID opcional dependiendo de categoría

building:
string obligatorio

room:
string opcional

description:
string obligatorio
máximo 50 palabras

contactPhone:
string | null

inventoryItemId:
UUID | null

El backend debe:

## 1. obtener usuario autenticado;
## 2. validar categoría;
## 3. validar subcategoría;
## 4. determinar prioridad automáticamente;
## 5. status inicial = OPEN;
## 6. generar code;
## 7. guardar snapshots del reportero;
## 8. verificar límite de tickets;
## 9. verificar duplicados;
## 10. crear TicketEvent CREATED;
## 11. ejecutar todo lo que corresponda dentro de una transacción.

Respuesta 201:

{
  "success": true,
  "data": {
    "id": "uuid",
    "code": "TK-001045",
    "title": "Proyector sin señal",
    "description": "El proyector enciende pero no muestra señal.",
    "category": {
      "id": "uuid",
      "code": "PROJECTOR_FAILURE",
      "name": "Falla de proyector"
    },
    "subcategory": {
      "id": "uuid",
      "code": "CONNECTION_FAILURE",
      "name": "Falla de conexión"
    },
    "location": {
      "building": "Edificio 6",
      "room": "603"
    },
    "priority": "HIGH",
    "status": "OPEN",
    "assignee": null,
    "createdAt": "ISO_DATE"
  }
}

Errores esperados:

422 VALIDATION_ERROR
404 CATEGORY_NOT_FOUND
404 SUBCATEGORY_NOT_FOUND
409 DUPLICATE_TICKET
409 ACTIVE_TICKET_LIMIT_REACHED
403 SOFTWARE_REQUEST_REQUIRES_TEACHER

## 9. SOLICITUD DE SOFTWARE

Cuando Category.code sea SOFTWARE_INSTALLATION:

solo se permitirá cuando:

user.communityType === TEACHER

Request adicional obligatorio:

{
  "software": {
    "name": "AutoCAD",
    "version": "2027",
    "downloadUrl": "https://...",
    "coordinationApprovalReference": "OFICIO-FCQI-2026-184"
  }
}

Si no es TEACHER:

403

{
  "success": false,
  "error": {
    "code": "SOFTWARE_REQUEST_REQUIRES_TEACHER",
    "message": "Las solicitudes de instalación de software requieren una cuenta de docente."
  },
  "requestId": "..."
}

## 10. REGLA DE 10 TICKETS ACTIVOS

Cada USER puede tener como máximo 10 tickets activos.

Estados activos:

### OPEN
IN_REVIEW
IN_PROGRESS

Estados no activos:

### COMPLETED
### CANCELLED

La verificación debe ser segura ante solicitudes concurrentes.

No debe ser vulnerable a:

request A -> count = 9
request B -> count = 9
A crea
B crea
resultado = 11

Utilizar transacción/locking/aislamiento adecuado.

## 11. DUPLICADOS

Los tickets activos no pueden duplicarse usando:

category
subcategory
building
room

Normalizar los valores.

Generar duplicateKey determinística.

Idealmente:

SHA256(
  categoryId +
  subcategoryId +
  normalizedBuilding +
  normalizedRoom
)

duplicateKey puede ser nullable y UNIQUE.

Al COMPLETED/CANCELLED:

duplicateKey = null

Esto permite volver a reportar una falla después de cerrar la incidencia.

La verificación debe soportar concurrencia.

## 12. AUTENTICACIÓN

Express manejará Google OAuth.

NO utilizar NextAuth.

Endpoints:

GET /api/v1/auth/google

Inicia OAuth.

Respuesta:
302 redirect a Google.

GET /api/v1/auth/google/callback

Google envía:

code
state

El backend debe:

- comprobar state;
- intercambiar authorization code;
- validar identidad;
- validar email_verified;
- validar dominio contra ALLOWED_EMAIL_DOMAINS;
- obtener sub;
- obtener name;
- obtener picture;
- localizar usuario por email/googleSubject;
- crear/vincular sesión;
- actualizar lastLoginAt.

Si usuario existente:

302 FRONTEND_URL/auth/success

Si usuario nuevo:

302 FRONTEND_URL/auth/complete-profile

POST /api/v1/auth/complete-profile

Solo para onboarding autenticado.

Body:

{
  "institutionalId": "1287456",
  "communityType": "STUDENT",
  "phone": null
}

NO recibe:

name
email
role
googleSubject

Estos vienen de Google/backend.

Nuevo usuario siempre:

role = USER

GET /api/v1/auth/me

Respuesta:

{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "usuario@uabc.edu.mx",
    "fullName": "Aziel Medina",
    "institutionalId": "1287456",
    "phone": null,
    "role": "USER",
    "communityType": "STUDENT",
    "supportAreas": [],
    "skills": [],
    "avatarUrl": null
  }
}

Sin sesión:

401 AUTHENTICATION_REQUIRED

POST /api/v1/auth/logout

Respuesta:

204 No Content

## 13. SESIÓN

Usar cookie HTTP-only.

Nombre recomendado:

sist_session

Configuración:

httpOnly = true
secure = true en producción
sameSite configurable
path = /

JWT no debe devolverse al frontend.

Payload JWT mínimo:

{
  "sub": "USER_UUID",
  "email": "usuario@uabc.edu.mx"
}

No depender exclusivamente del role contenido en JWT.

Cada petición protegida debe comprobar que el usuario:
- existe;
- está activo;
- conserva permisos actuales.

JWT_SECRET es obligatorio.

PROHIBIDO:

process.env.JWT_SECRET || "default_secret"

## 14. RBAC

USER:

- autenticarse;
- completar perfil;
- modificar algunos datos propios;
- crear ticket;
- consultar sus tickets;
- consultar sus detalles;
- consultar timeline propia;
- consultar categorías/catalogo.

SUPPORT:

Todo lo de lectura que corresponda, además:

- visualizar tickets de sus supportAreas;
- filtrar tickets;
- autoasignarse;
- cambiar estado de tickets permitidos;
- finalizar ticket;
- consultar bitácora.

NO puede modificar bitácora.

SUB_MANAGER:

Todo SUPPORT además:

- crear entradas de bitácora;
- modificar bitácora;
- gestionar inventario.

ADMIN:

Todo SUB_MANAGER además:

- consultar todos los tickets;
- asignar técnicos;
- quitar asignaciones;
- cambiar prioridad;
- administrar categorías;
- administrar subcategorías;
- administrar miembros de soporte;
- consultar dashboard administrativo;
- generar reportes.

## 15. TICKETS - LISTADO

GET /api/v1/tickets

Query params soportados:

page
pageSize
search
status
priority
categoryId
subcategoryId
assignment
assignedTo
supportArea
createdFrom
createdTo
sort
order

Valores iniciales recomendados:

page=1
pageSize=20
sort=createdAt
order=desc

USER:
solo puede ver sus propios tickets.

SUPPORT:
solo tickets correspondientes a sus áreas.

SUB_MANAGER:
solo tickets correspondientes a sus áreas.

ADMIN:
todos.

Respuesta:

{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "code": "TK-001045",
      "title": "Proyector sin señal",
      "category": {
        "id": "uuid",
        "name": "Falla de proyector"
      },
      "subcategory": {
        "id": "uuid",
        "name": "Falla de conexión"
      },
      "location": {
        "building": "Edificio 6",
        "room": "603"
      },
      "priority": "HIGH",
      "status": "IN_PROGRESS",
      "assignee": {
        "id": "uuid",
        "fullName": "Carlos Medina"
      },
      "createdAt": "ISO_DATE"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "totalPages": 1
  }
}

## 16. DETALLE TICKET

GET /api/v1/tickets/:id

Respuesta:

{
  "success": true,
  "data": {
    "id": "uuid",
    "code": "TK-001045",
    "title": "Proyector sin señal",
    "description": "...",

    "reporter": {
      "id": "uuid",
      "fullName": "...",
      "email": "...",
      "phone": null,
      "communityType": "TEACHER"
    },

    "category": {
      "id": "uuid",
      "code": "PROJECTOR_FAILURE",
      "name": "Falla de proyector"
    },

    "subcategory": {
      "id": "uuid",
      "code": "CONNECTION_FAILURE",
      "name": "Falla de conexión"
    },

    "location": {
      "building": "Edificio 6",
      "room": "603"
    },

    "priority": "HIGH",
    "status": "IN_PROGRESS",

    "assignee": {
      "id": "uuid",
      "fullName": "Carlos Medina"
    },

    "inventoryItem": null,

    "createdAt": "ISO_DATE",
    "assignedAt": "ISO_DATE",
    "completedAt": null
  }
}

404 TICKET_NOT_FOUND
403 FORBIDDEN_TICKET

## 17. TIMELINE

GET /api/v1/tickets/:id/events

Respuesta:

{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "type": "CREATED",
      "actor": {
        "id": "uuid",
        "fullName": "Aziel Medina"
      },
      "fromStatus": null,
      "toStatus": "OPEN",
      "metadata": {},
      "createdAt": "ISO_DATE"
    }
  ]
}

## 18. AUTOASIGNACIÓN

POST /api/v1/tickets/:id/assign-self

Roles:

### SUPPORT
SUB_MANAGER

Body:
ninguno.

Reglas:

- ticket activo;
- no asignado;
- área compatible;
- usuario activo;
- operación atómica;
- exactamente un ganador ante concurrencia.

Respuesta:

{
  "success": true,
  "data": {
    "id": "uuid",
    "assignee": {
      "id": "uuid",
      "fullName": "Aziel Medina"
    },
    "assignedAt": "ISO_DATE"
  }
}

Errores:

404 TICKET_NOT_FOUND
409 TICKET_ALREADY_ASSIGNED
409 TICKET_NOT_ACTIVE
403 TICKET_OUTSIDE_SUPPORT_AREA

## 19. ASIGNACIÓN ADMINISTRATIVA

PUT /api/v1/tickets/:id/assignee

Solo ADMIN.

Body:

{
  "assigneeId": "uuid"
}

El assignee debe:
- existir;
- estar activo;
- ser SUPPORT o SUB_MANAGER;
- tener un área compatible.

Respuesta:
Ticket actualizado.

DELETE /api/v1/tickets/:id/assignee

Solo ADMIN.

Respuesta:
204

Debe crear TicketEvent UNASSIGNED.

## 20. ESTADOS

PATCH /api/v1/tickets/:id/status

Roles:

### SUPPORT
SUB_MANAGER
### ADMIN

Body:

{
  "status": "IN_PROGRESS",
  "note": "Se inició la revisión."
}

Soportar header:

Idempotency-Key

Transiciones iniciales permitidas:

OPEN -> IN_REVIEW
OPEN -> IN_PROGRESS
IN_REVIEW -> IN_PROGRESS
IN_PROGRESS -> COMPLETED

Permitir cancelación según permisos definidos por backend:

OPEN -> CANCELLED
IN_REVIEW -> CANCELLED
IN_PROGRESS -> CANCELLED

COMPLETED y CANCELLED son estados terminales para el MVP.

Respuesta:

{
  "success": true,
  "data": {
    "id": "uuid",
    "code": "TK-001045",
    "status": "IN_PROGRESS",
    "updatedAt": "ISO_DATE"
  }
}

Errores:

409 INVALID_STATUS_TRANSITION
409 IDEMPOTENCY_CONFLICT
403 FORBIDDEN_TICKET

Al COMPLETED:

completedAt = now
duplicateKey = null

Al CANCELLED:

cancelledAt = now
duplicateKey = null

Crear TicketEvent STATUS_CHANGED.

## 21. PRIORIDAD MANUAL

PATCH /api/v1/tickets/:id/priority

Solo ADMIN.

Body:

{
  "priority": "HIGH",
  "reason": "Se requiere antes del examen colegiado."
}

reason obligatorio.

Crear TicketEvent PRIORITY_CHANGED.

## 22. TICKET EVENT

Campos:

id
ticketId
actorId
type
fromStatus
toStatus
metadata JSON
createdAt

Tipos:

### CREATED
### ASSIGNED
### UNASSIGNED
STATUS_CHANGED
PRIORITY_CHANGED
### CANCELLED

No eliminar eventos históricos.

## 23. CATÁLOGO FORMULARIO

GET /api/v1/catalog/ticket-form

Autenticado.

Respuesta aproximada:

{
  "success": true,
  "data": {
    "categories": [
      {
        "id": "uuid",
        "code": "PROJECTOR_FAILURE",
        "name": "Falla de proyector",
        "supportArea": "HARDWARE",
        "defaultPriority": "HIGH",
        "requiresSoftwareDetails": false,
        "subcategories": [
          {
            "id": "uuid",
            "code": "CONNECTION_FAILURE",
            "name": "Falla de conexión",
            "priority": "HIGH"
          }
        ]
      }
    ],
    "maxActiveTickets": 10
  }
}

## 24. CATEGORÍAS

GET /api/v1/categories

Autenticado.

POST /api/v1/categories

ADMIN.

Body:

{
  "code": "PROJECTOR_FAILURE",
  "name": "Falla de proyector",
  "supportArea": "HARDWARE",
  "defaultPriority": "HIGH",
  "requiresSoftwareDetails": false
}

PATCH /api/v1/categories/:id

ADMIN.

Body parcial.

DELETE /api/v1/categories/:id

ADMIN.

NO hard delete.

isActive = false

## 25. SUBCATEGORÍAS

POST /api/v1/categories/:categoryId/subcategories

ADMIN.

Body:

{
  "code": "CONNECTION_FAILURE",
  "name": "Falla de conexión",
  "priority": "HIGH"
}

PATCH /api/v1/subcategories/:id

ADMIN.

DELETE /api/v1/subcategories/:id

ADMIN.

Soft delete.

## 26. SUPPORT SUGGESTIONS

GET /api/v1/catalog/support-suggestions

Query:

categoryId
subcategoryId

Respuesta:

{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "Verificar cable HDMI",
      "description": "Comprueba que el cable se encuentre conectado..."
    }
  ]
}

Esta funcionalidad puede implementarse después del MVP.

## 27. PERFIL

PATCH /api/v1/users/me

Usuario autenticado.

Body permitido:

{
  "fullName": "Nombre completo",
  "phone": "6641234567"
}

NO permitir cambiar por esta ruta:

email
institutionalId
role
communityType
supportAreas
skills
isActive
googleSubject

## 28. BITÁCORA

ActivityLog debe contener:

id
ticketId
activity

Snapshots:
ticketCodeSnapshot
ticketTitleSnapshot
failureSnapshot
reporterNameSnapshot
reporterEmailSnapshot
reporterPhoneSnapshot

serviceStartedAt
serviceEndedAt
timeSpentMinutes
status

createdById
createdAt
updatedAt

Participantes:
relación N:M con User.

GET /api/v1/activity-log

### SUPPORT
SUB_MANAGER
### ADMIN

Filtros:

ticketId
technicianId
status
search
from
to
page
pageSize

SUPPORT:
solo lectura.

POST /api/v1/activity-log

SUB_MANAGER
### ADMIN

Body:

{
  "ticketId": "uuid",
  "activity": "Diagnóstico de conectividad y revisión de cableado.",
  "participantIds": [
    "uuid",
    "uuid"
  ],
  "serviceStartedAt": "ISO_DATE",
  "serviceEndedAt": "ISO_DATE",
  "timeSpentMinutes": 90,
  "status": "IN_PROGRESS"
}

NO pedir al frontend:
- reporterName;
- reporterEmail;
- nombre ticket;
- falla.

Obtenerlos desde Ticket y guardar snapshots.

GET /api/v1/activity-log/:id

### SUPPORT
SUB_MANAGER
### ADMIN

PATCH /api/v1/activity-log/:id

SUB_MANAGER
### ADMIN

Body parcial solamente sobre campos editables.

Cada PATCH debe crear ActivityLogRevision.

GET /api/v1/activity-log/:id/history

SUB_MANAGER
### ADMIN

## 29. AUDITORÍA BITÁCORA

ActivityLogRevision:

id
activityLogId
changedById
previousData JSON
newData JSON
createdAt

Debe ser inmutable.

No debe existir endpoint para modificar o eliminar revisiones.

## 30. INVENTARIO

InventoryItem:

id
type
model
assetCode
color
size
building
room
serialNumber
quantity
notes
isActive
createdAt
updatedAt

GET /api/v1/inventory

SUB_MANAGER
### ADMIN

Filtros:

search
type
building
active
page
pageSize

POST /api/v1/inventory

SUB_MANAGER
### ADMIN

Ejemplo COMPUTER:

{
  "type": "COMPUTER",
  "model": "Dell OptiPlex 7090",
  "assetCode": "PAT-00421",
  "color": "Negro",
  "size": "SFF",
  "building": "Edificio 6",
  "room": "603",
  "serialNumber": "DX92K1",
  "quantity": 1,
  "notes": null
}

Validación según type:

COMPUTER:
model requerido
assetCode requerido
color requerido
size requerido
building requerido
serialNumber requerido

PROJECTOR:
model requerido
assetCode requerido
color requerido
size requerido

CONTROL:
model requerido
quantity requerido

ADAPTER:
model requerido
quantity requerido

GET /api/v1/inventory/:id

SUB_MANAGER
### ADMIN

PATCH /api/v1/inventory/:id

SUB_MANAGER
### ADMIN

DELETE /api/v1/inventory/:id

SUB_MANAGER
### ADMIN

Soft delete:
isActive = false

GET /api/v1/inventory/:id/tickets

SUB_MANAGER
### ADMIN

Devuelve historial de fallas vinculadas al dispositivo.

## 31. MIEMBROS DE SOPORTE

GET /api/v1/support-members

### ADMIN

Filtros:

search
role
supportArea
active

POST /api/v1/support-members

### ADMIN

Body:

{
  "fullName": "Carlos Medina",
  "email": "carlos@uabc.edu.mx",
  "institutionalId": "1278123",
  "communityType": "STUDENT",
  "role": "SUPPORT",
  "supportAreas": [
    "HARDWARE"
  ],
  "skills": [
    "Equipos de cómputo",
    "Proyectores"
  ]
}

Solo permitir mediante esta ruta:

### SUPPORT
SUB_MANAGER

No permitir USER.
No permitir ADMIN.

Cuando posteriormente esta persona inicie Google OAuth con el mismo correo:

vincular googleSubject al usuario existente.

GET /api/v1/support-members/:id

### ADMIN

PATCH /api/v1/support-members/:id

### ADMIN

Campos permitidos:

fullName
role
supportAreas
skills
isActive

DELETE /api/v1/support-members/:id

### ADMIN

Soft delete:

isActive = false

## 32. DASHBOARD

GET /api/v1/dashboard

Respuesta según rol.

USER:

{
  "success": true,
  "data": {
    "stats": {
      "active": 3,
      "inProgress": 2,
      "completed": 18
    },
    "recentTickets": []
  }
}

SUPPORT / SUB_MANAGER:

{
  "success": true,
  "data": {
    "stats": {
      "unassigned": 12,
      "mine": 4,
      "highPriority": 7,
      "completedToday": 9
    },
    "priorityTickets": []
  }
}

ADMIN:

{
  "success": true,
  "data": {
    "stats": {
      "activeTickets": 26,
      "unassigned": 12,
      "activeTechnicians": 8,
      "inventoryItems": 143
    },
    "technicianWorkload": [
      {
        "userId": "uuid",
        "name": "Carlos Medina",
        "supportAreas": [
          "HARDWARE"
        ],
        "activeTickets": 4,
        "completedToday": 3
      }
    ]
  }
}

## 33. REPORTES

GET /api/v1/reports/activity

ADMIN.

Query:

from
to
supportArea
categoryId
technicianId

from y to obligatorios.

Respuesta:

{
  "success": true,
  "data": {
    "summary": {
      "ticketsCreated": 128,
      "ticketsCompleted": 111,
      "pending": 17,
      "averageResolutionMinutes": 384
    },

    "byCategory": [
      {
        "categoryId": "uuid",
        "category": "Falla de equipo",
        "count": 42
      }
    ],

    "byTechnician": [
      {
        "technicianId": "uuid",
        "name": "Carlos Medina",
        "completed": 27,
        "active": 4
      }
    ],

    "daily": [
      {
        "date": "2026-09-01",
        "created": 4,
        "completed": 3
      }
    ]
  }
}

## 34. NOTIFICACIONES

NotificationOutbox:

id
type
recipientEmail
ticketId
payload JSON
status
attempts
availableAt
sentAt
lastError
dedupeKey
createdAt
updatedAt

Estados:

### PENDING
### SENT
### FAILED

Cuando se asigna un ticket:

## 1. guardar asignación;
## 2. crear NotificationOutbox PENDING;
## 3. commit de la transacción;
## 4. procesamiento del correo fuera de la petición principal.

Si SMTP falla:

el ticket DEBE permanecer asignado.

Recordatorio:

tickets activos durante más de 7 días.

Máximo:
1 recordatorio por ticket por día.

Utilizar dedupeKey.

## 35. HEALTH

GET /health

200:

{
  "status": "ok"
}

GET /ready

200:

{
  "status": "ready",
  "database": "connected"
}

Si PostgreSQL no responde:

## 503. 36. DOCUMENTACIÓN

Swagger UI:

GET /api/docs

OpenAPI JSON:

GET /api/openapi.json

Cada endpoint debe documentar:

- descripción;
- autenticación;
- roles;
- path params;
- query params;
- request body;
- response exitosa;
- errores;
- ejemplos.

Además deberá existir finalmente:

docs/API.md

docs/FRONTEND_INTEGRATION.md

## 37. HELPER FRONTEND ESPERADO

La API deberá diseñarse para poder consumirse con algo equivalente a:

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(
    API_URL + "/api/v1" + path,
    {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    }
  );

  if (response.status === 204) {
    return undefined as T;
  }

  const json = await response.json();

  if (!response.ok) {
    throw new Error(
      json.error?.message ?? "Error desconocido"
    );
  }

  return json.data;
}

Por lo tanto, configura correctamente CORS para credentials.

## 38. SEGURIDAD

Agregar:

Helmet
CORS restringido
rate limiting
validación Zod
cookies httpOnly
JWT_SECRET obligatorio
Google OAuth state
validación de roles
validación de ownership/áreas
error handler centralizado

Nunca permitir mass assignment directo desde req.body hacia Prisma.

Nunca hacer:

prisma.user.update({
  data: req.body
})

sin seleccionar explícitamente los campos permitidos.

## 39. VARIABLES DE ENTORNO

La aplicación deberá usar al menos:

NODE_ENV
### PORT
DATABASE_URL

FRONTEND_URL

JWT_SECRET
SESSION_COOKIE_NAME

GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI

ALLOWED_EMAIL_DOMAINS

SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
SMTP_FROM

No incluir valores reales en Git.

Crear .env.example.

## 40. LOGGING

Usar logs estructurados.

Preferentemente Pino.

Cada petición:

requestId
method
url
status
durationMs
userId cuando exista

Errores:

timestamp
level
requestId
message
stack

Stack solamente logs internos.

## 41. PAGINACIÓN

Todos los listados grandes deben utilizar paginación.

Formato:

{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 200,
    "totalPages": 10
  }
}

pageSize máximo recomendado:

100

## 42. ENDPOINTS FINALES DEL CONTRATO

### AUTH

GET     /api/v1/auth/google
GET     /api/v1/auth/google/callback
POST    /api/v1/auth/complete-profile
GET     /api/v1/auth/me
POST    /api/v1/auth/logout

### USER

PATCH   /api/v1/users/me

### CATALOG

GET     /api/v1/catalog/ticket-form
GET     /api/v1/catalog/support-suggestions

### CATEGORIES

GET     /api/v1/categories
POST    /api/v1/categories
PATCH   /api/v1/categories/:id
DELETE  /api/v1/categories/:id

### SUBCATEGORIES

POST    /api/v1/categories/:categoryId/subcategories
PATCH   /api/v1/subcategories/:id
DELETE  /api/v1/subcategories/:id

### TICKETS

POST    /api/v1/tickets
GET     /api/v1/tickets
GET     /api/v1/tickets/:id
GET     /api/v1/tickets/:id/events
POST    /api/v1/tickets/:id/assign-self
PUT     /api/v1/tickets/:id/assignee
DELETE  /api/v1/tickets/:id/assignee
PATCH   /api/v1/tickets/:id/status
PATCH   /api/v1/tickets/:id/priority

### DASHBOARD

GET     /api/v1/dashboard

### ACTIVITY LOG

GET     /api/v1/activity-log
POST    /api/v1/activity-log
GET     /api/v1/activity-log/:id
PATCH   /api/v1/activity-log/:id
GET     /api/v1/activity-log/:id/history

### INVENTORY

GET     /api/v1/inventory
POST    /api/v1/inventory
GET     /api/v1/inventory/:id
PATCH   /api/v1/inventory/:id
DELETE  /api/v1/inventory/:id
GET     /api/v1/inventory/:id/tickets

### SUPPORT MEMBERS

GET     /api/v1/support-members
POST    /api/v1/support-members
GET     /api/v1/support-members/:id
PATCH   /api/v1/support-members/:id
DELETE  /api/v1/support-members/:id

### REPORTS

GET     /api/v1/reports/activity

### SYSTEM

GET     /health
GET     /ready

### DOCUMENTATION

GET     /api/docs
GET     /api/openapi.json

## 43. REGLAS GENERALES DE IMPLEMENTACIÓN

Cada módulo debe seguir una estructura clara equivalente a:

module.routes.ts
module.controller.ts
module.service.ts
module.schema.ts

Puede agregarse repository si realmente aporta valor.

Los controllers:
- reciben HTTP;
- no contienen lógica de negocio compleja.

Los services:
- contienen reglas de negocio.

Zod:
- valida inputs HTTP.

Prisma:
- capa de persistencia.

No usar any salvo que sea absolutamente necesario.

Utilizar TypeScript strict.

No realizar cambios innecesarios al CLI Vane.

No eliminar funcionalidades del CLI salvo código exclusivamente de demostración del template.

## 44. PRUEBAS

Agregar pruebas para las funcionalidades críticas.

En particular:

Google auth/helpers cuando sea posible
### RBAC
creación de ticket
validaciones
máximo 10 activos
duplicados
duplicados concurrentes
autoasignación
autoasignación concurrente
transiciones de estado
idempotencia
bitácora
auditoría de bitácora
inventario
soft deletes
dashboard

## 45. REGLA DE LAS ETAPAS FUTURAS

A partir de ahora, antes de implementar CUALQUIER etapa:

## 1. lee docs/BACKEND_CONTRACT.md;
## 2. inspecciona el código actual;
## 3. identifica lo ya implementado;
## 4. implementa únicamente el alcance solicitado;
## 5. no cambies contratos anteriores;
## 6. actualiza OpenAPI cuando corresponda;
## 7. actualiza tests;
## 8. ejecuta pnpm build;
## 9. ejecuta tests;
## 10. informa cualquier discrepancia.

Ahora:

## 1. analiza el repositorio existente;
## 2. crea docs/BACKEND_CONTRACT.md con todo este contenido, mejorando solo su formato;
## 3. crea docs/IMPLEMENTATION_STATUS.md con una tabla:

| Módulo | Estado | Endpoints | Tests |
| ... |

Todos deben comenzar como NOT_STARTED salvo código real existente que pueda reutilizarse.

## 4. Identifica exactamente qué partes actuales del template serán reutilizadas.
## 5. Identifica qué partes actuales son código de demostración y deberían eliminarse posteriormente.
## 6. Comprueba que el proyecto compile antes de finalizar esta etapa.

NO implementes todavía el sistema completo.

---

## Discrepancias y decisiones pendientes detectadas en el repositorio

Estas observaciones son parte del diagnóstico de esta etapa; deben resolverse explícitamente en una etapa de implementación:

- El repositorio usa actualmente un modelo `User` entero con `password` y un modelo `Producto`; el contrato exige UUID, OAuth de Google y prohíbe contraseñas.
- Las migraciones existentes corresponden a datos de demostración (`Post`, `Libro`, `Uber`, `Producto`) y no representan el dominio del sistema.
- El middleware actual acepta la cookie `jwt` y el header Bearer, usa un secreto por defecto y devuelve respuestas no estandarizadas. El contrato exige `sist_session`, JWT_SECRET obligatorio, cookie HTTP-only y errores con formato estándar.
- Las rutas actuales están bajo `/api`, mientras el contrato exige funcionalidad bajo `/api/v1`, además de `/health`, `/ready` y documentación.
- El flujo actual de autenticación implementa registro/login con bcrypt; debe sustituirse por Google OAuth administrado por Express. No se implementó el reemplazo en esta etapa.
- El build inicial requirió generar el cliente Prisma porque `generated/prisma` está ignorado y no estaba disponible; generar artefactos de Prisma no cambia el contrato.
- El contrato permite “cancelación según permisos definidos por backend” para estados de ticket, pero no fija una matriz exacta por rol. Debe definirse antes de implementar esa transición.
- El contrato indica `duplicateKey` nullable y UNIQUE, pero no especifica la estrategia de índice para permitir múltiples valores NULL y garantizar unicidad solo en tickets activos; debe resolverse mediante una restricción/índice compatible con PostgreSQL.
- El contrato exige una colección inicial de categorías, pero no fija si se cargará mediante seed, migración o bootstrap. Debe decidirse antes de preparar datos iniciales.


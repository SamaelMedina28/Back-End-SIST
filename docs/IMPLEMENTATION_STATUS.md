# Estado final de implementación del backend

> Corte: 2026-10-04, Etapa 12 (auditoría final). El contrato operativo está en [BACKEND_CONTRACT.md](BACKEND_CONTRACT.md); las limitaciones verificables se separan de pendientes de operación en [TRACEABILITY.md](TRACEABILITY.md).

## Implementado (DONE)

| Módulo / capacidad | Estado | Evidencia |
|---|---|---|
| Prisma 7, PostgreSQL y migraciones aditivas | DONE | Schema, seis migraciones de dominio y estado de migraciones verificado |
| Seed de categorías/subcategorías | DONE | `prisma/seed.ts`, idempotente; no crea usuarios ni datos personales |
| Infraestructura HTTP, health/readiness, Helmet, CORS, validación y errores | DONE | `src/app.ts`, middlewares y tests de API |
| OAuth Google, onboarding y sesión HTTP-only | DONE (implementación) | OAuth state/PKCE, allowlist exacta, tests mockeados y usuario deshabilitado |
| RBAC y scopes por rol/área | DONE | Middleware y pruebas de integración PostgreSQL |
| Catálogo, categorías, subcategorías y sugerencias | DONE (API) | CRUD protegido, catálogo de ticket y endpoint de sugerencias |
| Tickets, prioridad y límite de 10 activos | DONE | Locks y transacciones PostgreSQL; pruebas de límite y carrera |
| Duplicados de ticket | DONE | `categoryId + building/room` normalizados; ignora subcategoría; UNIQUE y concurrencia |
| Número/código de ticket e idempotencia | DONE | Secuencia PostgreSQL e `IdempotencyRecord`; pruebas paralelas |
| Asignaciones, estados y eventos | DONE | Atomicidad, autorización por área, timeline e idempotencia |
| Dashboard por rol y reportes | DONE | Scope por rol, agregaciones SQL y zona horaria IANA |
| Activity Log e historial de revisiones | DONE | Snapshots, participantes, revisiones append-only y concurrencia |
| Inventario e historial por artículo | DONE | Reglas discriminadas, restricciones únicas y baja lógica |
| Miembros de soporte | DONE | Preaprovisionamiento, actualización, desactivación segura y vinculación OAuth |
| Notification Outbox y recordatorios | DONE (implementación) | Claim recuperable, reintentos, dedupe, estados terminales y transporte falso |
| OpenAPI/Swagger y documentación de API | DONE | `/api/openapi.json`, `/api/docs`, validación del documento y prueba de paridad |
| Logging estructurado/request ID | DONE | Pino, query string excluida, request ID entrante validado |
| Dockerfile y CI | DONE (configurados) | Imagen multi-stage; workflow con PostgreSQL temporal y sin secretos externos |

## Pendientes de integración real

| Capacidad | Estado | Qué falta |
|---|---|---|
| Login contra Google institucional | PENDING_REAL_INTEGRATION | Credenciales OAuth y prueba supervisada del redirect/cuenta real |
| Entrega de correo SMTP | PENDING_REAL_INTEGRATION | Host/remitente/credenciales y prueba supervisada; automatización usa fake |
| Contenido de sugerencias de soporte | PENDING / PRODUCT CONTENT | Producto/soporte debe entregar textos autorizados; no se inventó seed |
| Verificación de afiliación vigente a FCQI | PARTIAL / EXTERNAL | Se valida dominio exacto, no se consulta un directorio de matrícula/empleo |

## Operación y otros responsables

| Requisito | Estado | Responsable |
|---|---|---|
| 100 usuarios concurrentes, latencias p95/p99 y SLA por operación | PARTIAL / NOT VERIFIED | Ejecutar benchmark en infraestructura representativa; la auditoría no corrió carga |
| Disponibilidad 99.5 %, backups, RPO 12 h y RTO 2 h | OPS | Definir SLO, respaldos, restauración y failover fuera del código |
| Retención offline del formulario, responsive y accesibilidad | FRONTEND | Aplicación frontend y su suite E2E |
| Payload de página <3 MB | PARTIAL / FRONTEND | Paginación existe; medir payload real de API + frontend con datos de referencia |
| Política “no asuntos personales” | IMPLEMENTED_WITH_ASSUMPTION / POLICY | No se añadió clasificación automática; requiere política operativa determinista |
| Teléfono de onboarding | IMPLEMENTED_WITH_ASSUMPTION | Se permite omitirlo o enviar null; producto debe ratificar opcionalidad |

## Rutas

El inventario vigente contiene 43 operaciones funcionales bajo `/api/v1`, más `GET /health` y `GET /ready`. También se sirven `GET /api/docs` y `GET /api/openapi.json`. La prueba de contrato compara operaciones funcionales conocidas contra OpenAPI y `docs/API.md`; la referencia de uso es [API.md](API.md).

### Parche post-auditoría: catálogo de participantes de bitácora

Se añadió `GET /api/v1/catalog/activity-log-participants?ticketId=<uuid>` para `SUB_MANAGER` dentro de sus áreas y `ADMIN`. Devuelve los campos mínimos de usuarios activos elegibles según el validador existente del POST. `/support-members` sigue `ADMIN`-only; `participantIds` se valida nuevamente en servidor. No requiere migración.

## Etapa 12: cambios de auditoría

- Se corrigió `duplicateKey`: ahora se calcula con categoría y ubicación normalizada, sin subcategoría. Se conservaron el índice y las migraciones existentes; COMPLETED/CANCELLED liberan la clave como `NULL`.
- Se cambió el request logger para registrar `req.path` en vez de `originalUrl`; así no registra parámetros OAuth `code`/`state`. Los `X-Request-Id` entrantes fuera del formato o longitud aceptados se reemplazan por UUID generado.
- Se requiere que `NOTIFICATION_WORKER_ENABLED` esté activo si se habilita `REMINDER_JOB_ENABLED`; los ejemplos mantienen ambos flags apagados hasta configurar SMTP.
- Se ligó el puerto PostgreSQL de Compose a loopback, se reforzó `.gitignore` para env files y se añadieron Dockerfile, `.dockerignore`, CI, README de proyecto, códigos de error, despliegue, rendimiento, trazabilidad y auditoría final.
- No se añadió migración para esta etapa y ninguna migración aplicada se reescribió.

Los comandos y resultados de cierre de Etapa 12 se registran en [FINAL_AUDIT.md](FINAL_AUDIT.md). No hay una etapa siguiente incluida en este alcance.

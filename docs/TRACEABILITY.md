# Matriz de trazabilidad

Estados: `DONE` = implementación y evidencia en el repositorio; `PARTIAL` = implementación parcial o verificación pendiente; `PENDING_REAL_INTEGRATION` = depende de servicio/credenciales reales; `OPS` = responsabilidad de infraestructura; `FRONTEND` = fuera del backend; `EXTERNAL` = requiere fuente externa/política institucional; `IMPLEMENTED_WITH_ASSUMPTION` = decisión conservadora documentada que necesita ratificación de producto.

| Requisito | Estado | Evidencia de implementación y prueba | Pendiente / responsable |
|---|---|---|---|
| REST desacoplado bajo `/api/v1`, envelopes y errores estables | DONE | `src/app.ts`, routers por módulo, `docs/API.md`, OpenAPI y test de paridad de rutas | Ninguno conocido |
| Esquema Prisma y migraciones versionadas | DONE | `prisma/schema.prisma`, `prisma/migrations/`, `prisma migrate status` y CI PostgreSQL | Aplicar migraciones en cada entorno antes de desplegar |
| Seed de categorías idempotente | DONE | `prisma/seed.ts`; verificación doble en test DB | Confirmar catálogo con responsables de producto |
| Google OAuth por Express, state, PKCE, dominio y sesión HTTP-only | DONE | `src/modules/auth/`, pruebas OAuth mockeadas de spoof de dominio, state, onboarding y cookie | Prueba con credenciales institucionales reales: PENDING_REAL_INTEGRATION |
| Verificación de pertenencia real a FCQI (más allá del dominio del correo) | PARTIAL / EXTERNAL | Se valida email verificado y coincidencia exacta del dominio configurado | Directorio institucional/IdP no integrado; requiere autoridad y definición institucional |
| Restricción de correo a dominios allowlist | DONE | `ALLOWED_EMAIL_DOMAINS`, comparación exacta sin aceptar sufijos engañosos; pruebas de dominio spoof |
| RBAC y aislamiento por usuario, rol y área de soporte | DONE | `src/middlewares/rbac.middleware.ts`, `ticket.scope.ts`; tests PostgreSQL de listado, detalle, eventos y áreas |
| Ticket: validación, snapshots, prioridad, código secuencial, límite 10, duplicados | DONE | `ticket.service.ts`/`ticket.repository.ts`; integración PostgreSQL sobre duplicados concurrentes, 9→10/11º, números y cancelación/cierre |
| Duplicado por categoría + ubicación normalizada, ignorando subcategoría | DONE | SHA-256 canónico, índice UNIQUE nullable; test con subcategorías distintas | Ninguno conocido |
| Asignación, estado e idempotencia concurrente | DONE | `TicketEvent` transaccional, row locks, `IdempotencyRecord`; pruebas concurrentes PostgreSQL |
| Activity Log, snapshots y revisiones append-only | DONE | módulos Activity Log y `ActivityLogRevision`; concurrencia, no-op y rollback en PostgreSQL |
| Inventario, unicidad y baja lógica | DONE | servicio/repositorio/constraints; pruebas de tipo, campos allowlist y colisión concurrente |
| Dashboard por rol/zona horaria y reportes agregados | DONE | repositorios con scopes y agregaciones; pruebas de cambio horario, filtros y datos vacíos |
| Outbox, asignación y recordatorios diarios | DONE | outbox transaccional, claim `SKIP LOCKED`, dedupe local, retry y fallo SMTP simulado en tests |
| Entrega SMTP real | PENDING_REAL_INTEGRATION | Nodemailer y fake transport probados; redacción de errores | Requiere host, credenciales y prueba supervisada |
| Sugerencias: endpoint | DONE | `GET /api/v1/catalog/support-suggestions`, validación y tests |
| Sugerencias: contenido aprobado | PENDING / PRODUCT CONTENT | No se inventó seed; respuesta vacía si no hay registros activos | Producto/soporte debe proporcionar material autorizado |
| Regla “no asuntos personales” | IMPLEMENTED_WITH_ASSUMPTION / POLICY | No se añadió IA, heurística ni clasificación automática no especificada | Política operativa y definición determinista pendientes |
| Teléfono de onboarding opcional | IMPLEMENTED_WITH_ASSUMPTION | `phone` admite `null`/ausencia; ticket conserva `contactPhone ?? user.phone ?? null` | Confirmar con producto si debe ser opcional u obligatorio |
| Logging estructurado, request ID y protección de secretos en URL | DONE | Pino; logging solo `req.path`; request ID entrante validado; tests de code/state OAuth | Revisar políticas de retención de logs en infraestructura |
| Audit de dependencias | DONE (0 advisories) | `pnpm audit` sin vulnerabilidades tras overrides de versiones transitivas corregidas | Revisar de nuevo periódicamente y retirar overrides cuando el upstream los incorpore |
| Ruta funcional documentada en API, OpenAPI y router | DONE | Test compara inventario esperado, `openApiDocument` y encabezados de `docs/API.md` | Mantener el test al cambiar routers |
| 100 usuarios concurrentes / latencias objetivo | PARTIAL / NOT VERIFIED | Hay tests de concurrencia de reglas y consultas agregadas/indexadas | No hay benchmark de carga ni medición de SLA; ejecutar procedimiento en `PERFORMANCE.md` |
| Disponibilidad 99.5 %, backups, RPO 12 h, RTO 2 h | OPS | No afirmados como propiedades del código | SLO, backups y ejercicios de restauración corresponden a infraestructura |
| Retención offline del formulario, responsive y accesibilidad | FRONTEND | Backend ofrece API; no verifica UI | Frontend y pruebas de integración de extremo a extremo |
| Payload de página menor a 3 MB | PARTIAL / FRONTEND | Paginación limita páginas a 100 elementos | Medir con datos representativos e incluir assets/respuestas reales |

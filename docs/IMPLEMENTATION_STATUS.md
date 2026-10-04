# Estado de implementación del backend

> Corte de la Etapa 5: 2026-10-04. El contrato canónico está en [BACKEND_CONTRACT.md](./BACKEND_CONTRACT.md).

| Módulo | Estado | Endpoints | Tests |
|---|---|---:|---:|
| Modelo de datos Prisma 7 | DONE | 0 | Incluido en validación Prisma |
| Migración inicial del sistema | DONE (aplicada localmente) | 0 | Verificado en Etapa 1.5 |
| Seed idempotente de categorías | DONE (probado dos veces) | 0 | Verificado en Etapa 1.5 |
| PostgreSQL local reproducible | DONE (PostgreSQL local) | 0 | Verificado en Etapa 1.5 |
| Documentación de base de datos | DONE | 0 | N/A |
| Infraestructura HTTP común | DONE | 2 fuera de `/api/v1` | 5 de health/error/rate limit |
| Google OAuth | DONE / MOCKS | 2/2 | 10 de OAuth/identidad |
| Integración contra Google real | PENDING | N/A | Pendiente de credenciales reales |
| Sesión propia HTTP-only | DONE | 2/2 | 7 de sesión/logout + cookies |
| Onboarding | DONE | 1/1 | 7 de complete-profile |
| RBAC | DONE | Transversal | 5 de roles/áreas |
| Usuarios y perfil propio | DONE | 1/1 | 5 de perfil |
| Health/readiness | DONE | 2/2 | 3 de disponibilidad |
| Seguridad (Helmet, CORS, rate limit, Zod) | DONE | Transversal | Cubierto por integración |
| Logging estructurado y request ID | DONE | Transversal | Cubierto por respuestas de error |
| Categories API | DONE | 4/4 | 18 casos HTTP/rol/validación |
| Subcategories API | DONE | 3/3 | 7 casos HTTP/rol/validación |
| Ticket form catalog | DONE | 1/1 | 4 casos; activos y prioridades null |
| Support suggestions read API | DONE | 1/1 | 4 casos; sin seed ficticio |
| Resolución de prioridad efectiva | DONE | Utilidad compartida | 3 casos; herencia y null |
| OpenAPI / Swagger UI | DONE | 2/2 | 5 casos; schema validado y UI servida |
| Tickets Core: POST, listado, detalle y eventos | DONE | 4/13 | 30 tests PostgreSQL reales + 7 unitarios |
| Prevención de duplicados | DONE | Incluido en POST | UNIQUE PostgreSQL, normalización y concurrencia |
| Límite de 10 tickets activos | DONE | Incluido en POST | Lock del reportero, conteo y concurrencia PostgreSQL |
| Base PostgreSQL `support_system_test` | DONE | 0 | Migración y seed reales; guard de base de pruebas |
| Timeline / eventos de ticket | DONE | 1/1 de esta etapa | CREATED, orden, actor y RBAC |
| Autoasignación y asignación administrativa | DONE | 3/13 | PostgreSQL real: concurrencia, área, idempotencia de asignación y eventos |
| Estados, prioridad e idempotencia | DONE | 2/13 | PostgreSQL real: permisos, transiciones, cierre, replay/conflicto y prioridad |
| Dashboard | NOT_STARTED | 0/1 | 0 |
| Bitácora de actividad | NOT_STARTED | 0/5 | 0 |
| Auditoría de bitácora | NOT_STARTED | Incluido en bitácora | 0 |
| Inventario | NOT_STARTED | 0/7 | 0 |
| Miembros de soporte | NOT_STARTED | 0/5 | 0 |
| Reportes | NOT_STARTED | 0/1 | 0 |
| Notificaciones y outbox worker | NOT_STARTED | Sin endpoint directo | 0 |

## Etapa 2 implementada

- Express se compone mediante factories inyectables para que los tests no necesiten Google ni PostgreSQL reales.
- La configuración se valida con Zod al iniciar. No existe fallback para `JWT_SECRET`.
- Se habilitaron Helmet, CORS restringido a `FRONTEND_URL`, cookies, JSON/urlencoded, rate limit para OAuth/onboarding, request ID y logging estructurado con Pino.
- El flujo OAuth usa `google-auth-library`, scopes mínimos (`openid`, `email`, `profile`), `state` criptográfico y PKCE S256. No solicita acceso offline ni conserva tokens de Google.
- Las cuentas existentes se localizan por `googleSubject`; las cuentas preaprovisionadas se vinculan por email sin modificar su rol, áreas o habilidades.
- Una identidad nueva no crea un `User` en el callback. Recibe un JWT temporal de onboarding en cookie HTTP-only y el usuario se crea únicamente al completar los campos obligatorios.
- La sesión definitiva usa un JWT propio en cookie HTTP-only. Cada petición protegida vuelve a consultar al usuario y comprueba `isActive`, rol y áreas actuales.
- `PATCH /api/v1/users/me` aplica una lista explícita de campos permitidos: `fullName` y `phone`.
- Los errores tienen formato uniforme y no exponen stacks ni mensajes crudos de Prisma, Google o JWT.

## Endpoints disponibles

- `GET /api/v1/auth/google`
- `GET /api/v1/auth/google/callback`
- `POST /api/v1/auth/complete-profile`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`
- `PATCH /api/v1/users/me`
- `GET /api/v1/catalog/ticket-form`
- `GET /api/v1/catalog/support-suggestions`
- `POST /api/v1/tickets`
- `GET /api/v1/tickets`
- `GET /api/v1/tickets/:id`
- `GET /api/v1/tickets/:id/events`
- `POST /api/v1/tickets/:id/assign-self`
- `PUT /api/v1/tickets/:id/assignee`
- `DELETE /api/v1/tickets/:id/assignee`
- `PATCH /api/v1/tickets/:id/status`
- `PATCH /api/v1/tickets/:id/priority`
- `GET /api/v1/categories`
- `POST /api/v1/categories`
- `PATCH /api/v1/categories/:id`
- `DELETE /api/v1/categories/:id`
- `POST /api/v1/categories/:categoryId/subcategories`
- `PATCH /api/v1/subcategories/:id`
- `DELETE /api/v1/subcategories/:id`
- `GET /health`
- `GET /ready`
- `GET /api/docs`
- `GET /api/openapi.json`

## Decisiones y discrepancias documentadas

- `Category.defaultPriority` y `Subcategory.priority` siguen siendo nullable por las prioridades configurables/heredables del contrato.
- `User.institutionalId` permanece obligatorio: el callback no persiste usuarios incompletos y delega la creación al onboarding.
- `sameSite` queda en `lax`, adecuado para el redirect OAuth de nivel superior. `secure` se habilita en producción.
- La cookie temporal de OAuth se elimina antes de procesar el callback, de modo que el navegador no la conserva para una reutilización normal. No se añadió Redis ni otra persistencia de challenges porque esta etapa permite explícitamente una cookie HTTP-only temporal.
- La integración real con Google no se ejecutó porque no se proporcionaron credenciales. La implementación y las rutas fueron probadas con un proveedor simulado.
- No se implementó OpenAPI en esta etapa porque no existía una estructura previa reutilizable y el alcance lo declaró opcional.
- No se implementaron endpoints de categorías, tickets, bitácora, inventario, dashboard, reportes, SMTP ni worker de notificaciones.
- Categorías y subcategorías se ordenan por `name ASC, id ASC`; sugerencias por `title ASC, id ASC`. El listado usa una lectura anidada del repositorio Prisma para evitar N+1.
- `includeInactive=true` está disponible únicamente para ADMIN. Las bajas son lógicas e idempotentes; desactivar categoría no desactiva sus subcategorías.
- `SupportSuggestion` no recibió seed: no había contenido técnico autorizado para inventar. El endpoint devuelve una lista vacía cuando no hay filas activas.
- Los tests de etapa 3 usan repositorios en memoria y Supertest; no conectan ni realizan operaciones destructivas en `support_system`. La implementación Prisma aún no tiene una prueba de integración con una base PostgreSQL exclusiva para tests.
- Swagger UI se sirve desde la dependencia local en `/api/docs`; la relajación de CSP requerida por sus assets se limita a esa ruta.

## Etapa 4 implementada

- `POST /tickets` es exclusivo de `USER`; valida body estricto, categoría/subcategoría/inventario activo, comunidad docente para solicitudes de software, prioridad heredada y snapshots del reportero. Crea `OPEN` y `TicketEvent CREATED` en una transacción.
- `duplicateKey` es SHA-256 de categoría, subcategoría y ubicación normalizada. El índice UNIQUE existente resuelve duplicados paralelos. El error Prisma se traduce a `409 DUPLICATE_TICKET` sin exponer detalles técnicos.
- Para `USER`, la transacción bloquea la fila del reportero mediante `SELECT ... FOR UPDATE`, cuenta tickets `OPEN`/`IN_REVIEW`/`IN_PROGRESS` y rechaza el undécimo. `number` proviene de `nextval` de la secuencia `SERIAL` existente; `code` usa `TK-` y al menos seis dígitos. No se necesitó migración nueva. Una secuencia puede tener huecos tras rollback.
- El listado aplica primero alcance por rol y luego filtros, paginación y orden allowlist; el detalle y eventos devuelven 403 cuando un ticket existe pero no es visible. Mappers explícitos evitan exponer `duplicateKey` y datos internos; el detalle conserva snapshots históricos.
- `assignment` acepta `mine`, `unassigned` y `assigned`. `USER` recibe 403 al usar `assignment`, `assignedTo` o `supportArea`; un miembro de soporte recibe `SUPPORT_AREA_FORBIDDEN` al pedir un área no asignada. Fechas ISO con zona horaria se interpretan como instantes inclusivos.
- La suite PostgreSQL usa `DATABASE_URL_TEST` y exige `support_system_test` antes de limpiar fixtures. La migración inicial y seed se aplicaron allí. `support_system` no fue reseteada ni limpiada.

## Verificación

- `prisma validate`: correcto.
- `prisma generate`: correcto; Prisma Client 7.9.1 generado.
- Etapa 5 agrega migración aditiva para `IdempotencyRecord`; sin cambios destructivos al esquema previo.
- `POST assign-self` serializa solicitudes con `SELECT ... FOR UPDATE`; asignaciones y eventos se guardan de forma atómica.
- Los cierres COMPLETED/CANCELLED preservan el asignado, liberan `duplicateKey`, guardan timestamps y hacen terminal al ticket. La cancelación requiere nota.
- Idempotencia persistente y multi-instancia: clave única por actor/scope/key, SHA-256 del payload y replay por 24 horas; no se agregó worker de limpieza.
- `pnpm test` con `DATABASE_URL_TEST` configurada: pendiente de la validación final de Etapa 5.
- `pnpm build`: pendiente de la validación final de Etapa 5.
- `tsc --noEmit`: pendiente de la validación final de Etapa 5.
- No existe login por contraseña ni campo `password` en `User`.
- No existe secreto JWT predeterminado ni CORS con origen `*`.
- Los tokens de Google no se persisten; el ID token se verifica y se descarta.
- Los stacks se registran internamente para errores inesperados y no se serializan al cliente.

## Próxima etapa

La siguiente etapa pendiente es Dashboard. Bitácora, auditoría, inventario, miembros de soporte, reportes y worker de notificaciones continúan sin implementar.

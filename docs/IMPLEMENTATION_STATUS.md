# Estado de implementación del backend

> Corte de la Etapa 2: 2026-10-03. El contrato canónico está en [BACKEND_CONTRACT.md](./BACKEND_CONTRACT.md).

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
| OpenAPI / Swagger UI | NOT_STARTED | 0/2 | 0 |

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
- `GET /health`
- `GET /ready`

## Decisiones y discrepancias documentadas

- `Category.defaultPriority` y `Subcategory.priority` siguen siendo nullable por las prioridades configurables/heredables del contrato.
- `User.institutionalId` permanece obligatorio: el callback no persiste usuarios incompletos y delega la creación al onboarding.
- `sameSite` queda en `lax`, adecuado para el redirect OAuth de nivel superior. `secure` se habilita en producción.
- La cookie temporal de OAuth se elimina antes de procesar el callback, de modo que el navegador no la conserva para una reutilización normal. No se añadió Redis ni otra persistencia de challenges porque esta etapa permite explícitamente una cookie HTTP-only temporal.
- La integración real con Google no se ejecutó porque no se proporcionaron credenciales. La implementación y las rutas fueron probadas con un proveedor simulado.
- No se implementó OpenAPI en esta etapa porque no existía una estructura previa reutilizable y el alcance lo declaró opcional.
- No se implementaron endpoints de categorías, tickets, bitácora, inventario, dashboard, reportes, SMTP ni worker de notificaciones.

## Verificación

- `prisma validate`: correcto.
- `prisma generate`: correcto; Prisma Client 7.9.1 generado.
- `pnpm test`: 1 archivo y 38 pruebas aprobadas.
- `pnpm build`: correcto.
- `tsc --noEmit`: correcto.
- No existe login por contraseña ni campo `password` en `User`.
- No existe secreto JWT predeterminado ni CORS con origen `*`.
- Los tokens de Google no se persisten; el ID token se verifica y se descarta.
- Los stacks se registran internamente para errores inesperados y no se serializan al cliente.

## Próxima etapa

La API de Categories/Catalog continúa en `NOT_STARTED`. No se avanzó a esa etapa.

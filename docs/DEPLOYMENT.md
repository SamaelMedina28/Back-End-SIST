# Despliegue y operación

## Runtime y base de datos

Usa Node.js 22 LTS, pnpm 11.20 y PostgreSQL compatible con el schema (CI usa PostgreSQL 18). Provisiona una base por ambiente, TLS y un usuario de aplicación con privilegios mínimos para consultas y cambios normales. Los tests deben usar exclusivamente una base separada cuyo nombre termine en `_test`.

Localmente puedes ejecutar `docker compose up -d postgres`; el puerto se enlaza a `127.0.0.1:5432` y la contraseña fija de Compose es solo de desarrollo. El contenedor Compose proporciona únicamente PostgreSQL; la API se ejecuta local o desde la imagen `Dockerfile`.

## Variables

Parte de `.env.example`; no copies secretos al repositorio. Variables obligatorias para iniciar:

| Variable | Uso |
|---|---|
| `DATABASE_URL` | PostgreSQL de la aplicación |
| `FRONTEND_URL` | Origen exacto permitido por CORS y destino de redirección |
| `JWT_SECRET` | Secreto aleatorio de al menos 32 caracteres |
| `SESSION_COOKIE_NAME` | Cookie de sesión (por defecto documentado: `sist_session`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Cliente y callback OAuth |
| `ALLOWED_EMAIL_DOMAINS` | Allowlist exacta separada por comas |
| `APP_TIMEZONE` | Zona IANA para métricas y recordatorios; usar `America/Tijuana` si corresponde |
| `PORT`, `NODE_ENV` | Puerto y entorno (`production` para despliegue) |

SMTP es opcional: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`; `SMTP_USER` y `SMTP_PASSWORD` deben configurarse juntos. El worker y los recordatorios están desactivados por defecto. Para entrega de correo configura SMTP, habilita `NOTIFICATION_WORKER_ENABLED=true` y, opcionalmente, `REMINDER_JOB_ENABLED=true`. No habilites el job de recordatorios si el worker está apagado. En producción con worker activo, host y remitente son obligatorios.

## OAuth

En Google Cloud registra como Authorized redirect URI exactamente `GOOGLE_REDIRECT_URI`, por ejemplo `https://api.example.edu/api/v1/auth/google/callback`. La URL debe ser HTTPS en producción. `FRONTEND_URL` es el origen del frontend, no el callback. El backend valida el email verificado y el dominio exacto configurado, pero no consulta un directorio para demostrar matrícula o afiliación vigente a FCQI.

## Migraciones y seed

En una tarea de release separada del arranque de la API:

```bash
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm db:migrate
pnpm db:seed
```

Revisa `pnpm exec prisma migrate status` antes/después del cambio. Haz backup previo de producción. Seed solo sincroniza el catálogo contratado; es idempotente y no crea cuentas ni datos personales. No uses `migrate dev`, `db push`, reset ni truncado como procedimiento de producción.

La imagen Docker compila la aplicación y contiene dependencias de runtime; no incluye `.env` y no ejecuta migraciones durante build ni arranque. Aplica migraciones antes de actualizar réplicas. Proporciona secretos mediante el gestor de secretos de la plataforma.

## Arranque, probes y apagado

Arranque compilado: `pnpm start` (o `node dist/src/server.js` en la imagen). `/health` indica que el proceso responde. `/ready` consulta PostgreSQL y responde `503` cuando no está disponible. SMTP no participa en readiness: un fallo de correo no revierte asignaciones ni debería retirar la API del balanceador.

SIGINT/SIGTERM detienen el worker, esperan el cierre HTTP, cierran el transporte SMTP y desconectan Prisma. Configura el orquestador con un `terminationGracePeriodSeconds` que permita completar el cierre; monitoriza logs por request ID y métricas de outbox sin registrar destinatarios ni secretos.

## Operación de producción

- TLS en proxy/balanceador y HTTPS para frontend/API; cookies `Secure`, CORS con origen exacto y `JWT_SECRET` aleatorio por ambiente.
- Mantener el puerto PostgreSQL privado; rotar credenciales y no reutilizar las de Compose/CI.
- Definir pool de conexiones acorde a réplicas y límites del servidor PostgreSQL.
- Configurar logs centralizados con retención y acceso limitado; exportar métricas de latencia, errores, saturación, outbox `PENDING/FAILED` y readiness.
- Automatizar backups cifrados, conservarlos fuera del host y ejecutar restauraciones de prueba.
- Disponibilidad 99.5 %, RPO 12 h y RTO 2 h son objetivos del requisito, no garantías del backend. Operaciones debe asignar SLO, frecuencia/retención de backups, replicación, monitoreo y simulacro que demuestren dichos objetivos.
- SMTP real y OAuth real requieren configuración y validación supervisada; la suite automatizada usa proveedor/correo falsos.

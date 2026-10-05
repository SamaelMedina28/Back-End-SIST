# Sistema Integral de Soporte Técnico — Backend

API REST modular para el Sistema Integral de Soporte Técnico de la FCQI-UABC. El backend gestiona autenticación institucional, tickets, asignaciones, bitácoras, inventario, dashboard, reportes y notificaciones.

## Stack y requisitos

- Node.js 22 LTS y pnpm 11.20 (Corepack recomendado).
- Express 5, TypeScript strict, Prisma 7, PostgreSQL y Zod.
- PostgreSQL local o Docker Compose.

## Instalación local

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
```

Configura en `.env` una base de datos local y los valores OAuth. Nunca confirmes `.env` ni pongas secretos reales en Git. Para levantar solo PostgreSQL con Docker:

```bash
docker compose up -d postgres
```

Compose publica PostgreSQL únicamente en `127.0.0.1:5432`; su contraseña fija es solo para desarrollo local. También puedes usar un PostgreSQL instalado localmente.

Prepara el esquema, carga las categorías del contrato y arranca el servidor:

```bash
pnpm exec prisma generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

El seed es idempotente y no crea usuarios ni datos personales. Usa una base vacía o compatible con el historial versionado; no apliques migraciones a una base ajena sin revisar su estado.

## Comandos

```bash
pnpm dev             # desarrollo con recarga
pnpm typecheck       # TypeScript sin emitir archivos
pnpm test            # suite Vitest; requiere DATABASE_URL_TEST para PostgreSQL
pnpm build           # compila a dist/
pnpm start           # arranca el build compilado
pnpm db:migrate      # prisma migrate deploy
pnpm db:seed         # seed de categorías/subcategorías
pnpm prisma:generate # genera el cliente Prisma
```

Las pruebas PostgreSQL validan que `DATABASE_URL_TEST` apunte a `support_system_test` y limpian únicamente esa base. Nunca configures `support_system` como base de pruebas.

## Producción

Compila y arranca con `pnpm build` y `pnpm start`, o construye la imagen multi-stage con `docker build -t sist-support-backend .`. El proceso no ejecuta migraciones durante el arranque ni dentro de la construcción de imagen: aplica primero las migraciones versionadas contra la base de destino, revisa la configuración y después despliega la API. Consulta [DEPLOYMENT.md](docs/DEPLOYMENT.md).

## API y arquitectura

- API funcional: `/api/v1`; OpenAPI JSON: `/api/openapi.json`; Swagger UI: `/api/docs`.
- Salud del proceso: `/health`; readiness de PostgreSQL: `/ready`.
- Módulos de dominio: `src/modules/`; composición HTTP: `src/app.ts` y `src/routes/index.ts`; esquema e historial: `prisma/`.
- Contratos y operación: [API](docs/API.md), [OpenAPI](docs/API.md), [autenticación](docs/AUTH.md), [base de datos](docs/DATABASE.md), [notificaciones](docs/NOTIFICATIONS.md), [integración frontend](docs/FRONTEND_INTEGRATION.md).
- Auditoría y requisitos: [FINAL_AUDIT](docs/FINAL_AUDIT.md), [trazabilidad](docs/TRACEABILITY.md), [códigos de error](docs/ERROR_CODES.md), [rendimiento](docs/PERFORMANCE.md), [despliegue](docs/DEPLOYMENT.md), [estado](docs/IMPLEMENTATION_STATUS.md).

## Google OAuth y correo

Registra en Google Cloud el URI exacto configurado en `GOOGLE_REDIRECT_URI` (local: `http://localhost:3000/api/v1/auth/google/callback`) y permite únicamente los dominios institucionales mediante `ALLOWED_EMAIL_DOMAINS`. El flujo está implementado y probado con proveedor simulado; la validación real requiere credenciales y prueba manual.

SMTP es opcional. El worker y los recordatorios vienen desactivados; configura SMTP antes de habilitarlos. Las pruebas usan un transporte falso y no envían correo real. Ver [AUTH.md](docs/AUTH.md) y [NOTIFICATIONS.md](docs/NOTIFICATIONS.md).

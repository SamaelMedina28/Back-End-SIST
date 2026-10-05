# Auditoría final del backend — Etapa 12

Fecha de corte: 2026-10-04. Alcance: revisar el contrato completo, implementación, API/OpenAPI, seguridad, concurrencia, migraciones, suite PostgreSQL, dependencias, despliegue y documentación. No se inició otra etapa ni se añadieron endpoints.

## Resultado

El backend funcional está implementado y sus verificaciones automatizadas pasan. No se considera certificada la operación real contra Google/SMTP ni el SLA de carga/producción: faltan credenciales, entorno de benchmark y controles de infraestructura. La base `support_system` no se modificó durante esta auditoría.

## Correcciones realizadas

- `duplicateKey` ahora se calcula a partir de categoría y ubicación normalizada (edificio/aula), sin subcategoría. Los tests prueban conflicto entre subcategorías distintas y liberación al cancelar.
- El logger de requests usa `req.path` y no registra query strings OAuth (`code`/`state`). `X-Request-Id` se valida por formato y longitud antes de aceptarse; hay prueba de ambos casos.
- Se removieron los `any` de los templates del CLI de arranque: el DMMF usa un tipo estructural y las entradas/id del servicio generado se derivan de los tipos del delegate Prisma.
- La configuración rechaza activar recordatorios sin el worker. `.env.example` deja worker/job apagados hasta preparar SMTP.
- Compose vincula PostgreSQL a loopback; `.gitignore` excluye todos los archivos `.env.*` excepto el ejemplo.
- El audit inicial encontró dependencias transitivas vulnerables. Se fijaron versiones corregidas en `pnpm-workspace.yaml` (`deepmerge-ts`, `mysql2`, `fast-uri`, `qs`, `brace-expansion`) y se regeneró el lockfile. `pnpm audit` final reportó cero advisories. El override de `deepmerge-ts` queda como seguimiento mientras Prisma lo actualiza upstream; véase [Prisma issue #30052](https://github.com/prisma/orm/issues/30052).
- Se añadieron una prueba explícita de paridad de rutas, guía de errores, matriz de trazabilidad, procedimiento de performance, guía de despliegue, README de proyecto, Dockerfile, `.dockerignore` y CI PostgreSQL.

## Evidencia ejecutada

| Comprobación | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | PASS; lockfile vigente después de los overrides |
| `pnpm exec prisma format` | PASS |
| `pnpm exec prisma validate` | PASS |
| `pnpm exec prisma generate` | PASS; Prisma Client 7.9.1 |
| `pnpm exec prisma migrate status` en `support_system` | PASS; 6 migraciones, esquema al día |
| `pnpm exec prisma migrate status` en `support_system_test` | PASS; 6 migraciones, esquema al día |
| Seed de `support_system_test`, dos ejecuciones consecutivas | PASS; ambas completaron. Verificación posterior: 10 categorías, 0 usuarios, 0 tickets y 0 categorías temporales `TEST_CORE_*` |
| `pnpm test` con `DATABASE_URL_TEST` | PASS; 10 archivos, 214 tests |
| Suite PostgreSQL | PASS; 91 tests (88 funcionales y 3 guards de seguridad de DB) |
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm build` | PASS |
| OpenAPI / rutas / documentación | PASS; `SwaggerParser.validate` y test de inventario esperado contra OpenAPI y API.md |
| `pnpm audit` | PASS; 0 advisories (0 critical/high/moderate/low) |
| `git diff --check` y chequeo del rango de Etapa 12 | PASS |
| Estado de migraciones | No se añadió migración y ninguna migración versionada se editó en esta etapa |

La ejecución PostgreSQL emite una advertencia no bloqueante de `pg@8.22.0` cuando Prisma ejecuta queries concurrentes en un mismo cliente transaccional. La traza apunta a `@prisma/adapter-pg@7.9.1` (`PgTransaction.performIO`); la suite pasa. Es una llamada que `pg@9` planea dejar de soportar y debe revisarse al actualizar Prisma/adapter/pg; no se ocultó la advertencia ni se cambió semántica de transacciones para silenciarla.

## Docker y CI

El Dockerfile fue revisado y corregido para incluir `dist/lib`, además de `dist/src` y Prisma Client generado. No se pudo construir la imagen porque, incluso fuera del sandbox, no existe socket ni daemon Docker en este equipo. El workflow CI contiene servicio PostgreSQL efímero, instalación congelada, generación, migración, seed doble, tests, typecheck y build; no depende de secretos productivos. El workflow no se ejecutó en un runner de GitHub durante esta tarea.

## Limitaciones que siguen abiertas

- Google real y SMTP real: requieren credenciales y validación supervisada.
- El control actual de FCQI es por email verificado y dominio exacto; no consulta directorio institucional.
- No se sembraron sugerencias porque falta contenido aprobado; “no asuntos personales” necesita política operativa determinista.
- Teléfono de onboarding sigue opcional (`null`/ausente) como decisión de implementación pendiente de confirmación de producto.
- No se ejecutó carga de 100 usuarios ni se midieron latencias p95/p99. Disponibilidad 99.5 %, backups, RPO 12 h y RTO 2 h dependen de infraestructura. Procedimiento en [PERFORMANCE.md](PERFORMANCE.md).
- Responsive, accesibilidad y retención offline pertenecen al frontend.

## Migraciones y seguridad de datos

El estado consultado de ambas bases fue “up to date”. En `support_system` únicamente se hizo una consulta de estado; no hubo migrate deploy, reset, truncate, seed ni escritura de datos durante esta etapa. La limpieza destructiva de pruebas verificó la base con sufijo `_test` y operó solo en `support_system_test`.

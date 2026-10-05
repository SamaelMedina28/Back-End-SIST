# Rendimiento y concurrencia

## Objetivos

El requisito solicita medir creación de tickets, búsqueda/listado, detalle, asignación, cambios de estado y reportes, además de soportar 100 usuarios concurrentes. Los tiempos objetivo de cada operación no están fijados aquí como garantías: deben acordarse con producto y medirse con el despliegue, volumen y hardware representativos. No se ha ejecutado una prueba de carga de 100 usuarios en esta auditoría.

## Medidas implementadas

- Listados paginados y filtros allowlist; el tamaño de página de tickets está limitado a 100.
- Índices de ticket para reportes de estado/fecha, búsquedas por reporter/assignee/status y orden; índices de inventario, bitácora y claves únicas definidos en `prisma/schema.prisma` y migraciones.
- Dashboard y reportes calculados en PostgreSQL con agregaciones en vez de cargar tickets completos en memoria.
- La fila del reportero serializa el máximo de 10 tickets; índice UNIQUE resuelve duplicados concurrentes. La secuencia PostgreSQL asigna números sin usar `MAX()`.
- `assign-self`, cambios idempotentes, Activity Log y claims del outbox protegen cambios concurrentes con locks/transacciones; el worker usa `FOR UPDATE SKIP LOCKED`.
- Pruebas de concurrencia reales contra `support_system_test` cubren duplicado, máximo de 10, numeración, autoasignación, claves de idempotencia, revisiones Activity Log, unicidad de inventario, claims de notificaciones y deduplicación de recordatorios.

## Trabajo no medido

La suite funcional no determina throughput ni latencia p95/p99. No se han medido 100 VUs, CPU/RAM, pool de conexiones bajo carga, latencias de cada ruta, volumen anual de datos, degradación SMTP ni recuperación ante failover. Availability 99.5 %, RPO 12 horas y RTO 2 horas son objetivos de operación; requieren observabilidad, backup, restauración y ejercicios en infraestructura.

## Procedimiento de carga seguro

Usa un ambiente aislado con migraciones aplicadas y datos sintéticos, nunca la base `support_system` compartida ni producción. Aprovisiona un usuario de prueba con rol/área adecuados, autentícalo por OAuth en ese ambiente y pasa su cookie de sesión al gestor de carga desde un secreto efímero del runner (no la escribas en el script, archivo versionado, argumentos visibles ni logs). Restringe el origen a un host de test explícito.

Con k6 instalado fuera de las dependencias de producción, prepara un script local que use `__ENV.LOAD_TEST_BASE_URL`, `__ENV.LOAD_TEST_COOKIE` y un perfil de 100 VUs. Comprueba previamente `GET /health` y `GET /ready`; luego ejecuta escenarios de lectura (listado paginado, detalle, dashboard y reportes) y de escritura sobre registros desechables del ambiente de test (crear, asignar y transición). Usa códigos/títulos únicos y limpia únicamente los fixtures de esa base al terminar. Mantén pausado el envío SMTP real o utiliza un sink controlado.

Registra commit, configuración del runner, versión de PostgreSQL, tamaño de pool, VUs/rampa/duración, volumen inicial, tasa de error y latencias p50/p95/p99 por operación. Compara con umbrales aprobados por producto/operaciones; no declares cumplimiento solo por terminar sin errores. `scripts/load-test.mjs` no se incluye: sin estrategia de sesión y datos de prueba ya definidos, un generador genérico podría enviar escrituras a un entorno equivocado.

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

Usa un ambiente aislado con migraciones aplicadas y datos sintéticos, nunca `support_system` ni producción. Aprovisiona un usuario de prueba (ADMIN para reportes; soporte para asignaciones), autentícalo por OAuth en ese ambiente y pasa la cookie desde un secreto efímero del runner: no la escribas en código, archivo versionado, argumentos visibles ni logs. Mantén SMTP apagado o utiliza un sink.

Con k6 instalado fuera de las dependencias de producción, crea un archivo temporal local `load-test.js` con este escenario de lectura (requiere explícitamente ambos valores y no tiene URL/cookie predeterminados):

```js
import http from "k6/http";
import { check } from "k6";

const base = __ENV.LOAD_TEST_BASE_URL;
const cookie = __ENV.LOAD_TEST_COOKIE;
if (!base || !cookie) throw new Error("Define LOAD_TEST_BASE_URL y LOAD_TEST_COOKIE para un ambiente aislado");
if (new URL(base).hostname.toLowerCase().includes("prod")) throw new Error("No apuntes la prueba a producción");

export const options = { vus: 100, duration: "5m" };
export default function () {
  const response = http.get(`${base}/api/v1/tickets?page=1&pageSize=20`, {
    headers: { Cookie: cookie }, tags: { operation: "ticket-list" },
  });
  check(response, { "ticket list responds 200": (res) => res.status === 200 });
}
```

Arranca primero el backend configurado contra la base desechable; comprueba `/health` y `/ready`. Ejecuta el escenario pasando URL de test y cookie desde un gestor de secretos o variables efímeras del shell/runner. Para detalle, dashboard y reportes añade IDs/fechas del fixture y etiquetas de operación. Mide escrituras (crear, asignar, cambiar estado) como escenario separado, con clave/título/ubicación únicos y limpieza limitada a la base aislada; no reutilices la carga de lectura para generar tickets.

Ejemplo de ejecución interactiva en una shell local (la cookie no se escribe como argumento ni se muestra al teclearla):

```bash
export LOAD_TEST_BASE_URL='http://localhost:3000'
read -rs LOAD_TEST_COOKIE
export LOAD_TEST_COOKIE
k6 run load-test.js
unset LOAD_TEST_COOKIE
```

Registra commit, configuración del runner, versión PostgreSQL, tamaño de pool, VUs/rampa/duración, volumen inicial, tasa de error y latencias p50/p95/p99 por operación. Compara con umbrales aprobados por producto/operaciones; no declares cumplimiento solo por terminar sin errores. El script no se agrega al repositorio porque depende de usuario, rol y fixtures específicos de cada ambiente. No se ejecutó una prueba de 100 VUs en esta auditoría.

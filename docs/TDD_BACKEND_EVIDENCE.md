# Evidencia TDD — política de transición de estados de ticket

Fecha de ejecución: 2026-10-17.

Este registro contiene los resultados observados durante esta ejecución. No atribuye metodología TDD a pruebas o código anteriores.

## Baseline

- Estado inicial del árbol: sin cambios locales; `HEAD` estaba en `489ae50` (`feat: add activity log participant candidates endpoint to catalog routes`).
- No existe una política aislada de transiciones con pruebas propias. La tabla estaba declarada en `src/modules/ticket/ticket.service.ts`:

  ```ts
  OPEN: [IN_REVIEW, IN_PROGRESS, CANCELLED]
  IN_REVIEW: [IN_PROGRESS, CANCELLED]
  IN_PROGRESS: [COMPLETED, CANCELLED]
  COMPLETED: []
  CANCELLED: []
  ```

- `changeStatus` exige que el ticket siga activo; una solicitud al mismo estado se maneja por separado como no-op idempotente, y solo las solicitudes con estado distinto consultan la tabla. La integración también cubre rechazar `OPEN -> COMPLETED`.
- Prueba unitaria baseline: `pnpm exec vitest run tests/ticket.unit.test.ts` — **6 pasaron**.
- Prueba de integración baseline seleccionada: `DATABASE_URL_TEST='postgresql://samael@localhost:5432/support_system_test?host=/var/run/postgresql' pnpm exec vitest run tests/ticket.postgres.integration.test.ts -t 'estado respeta área, asignación, transición, cancelación y timestamps terminales'` — **1 pasó, 91 omitidas por el filtro**. El primer intento dentro del sandbox no alcanzó el socket PostgreSQL (`connect EPERM`); se repitió con autorización fuera del sandbox contra `support_system_test` y pasó.

## Ciclos TDD

### Prueba 1 — permite OPEN -> IN_REVIEW

Objetivo: expresar el primer arco permitido por la tabla existente.

Preparación: no había un módulo aislado; se creó solamente esta prueba:

```ts
it("permite OPEN -> IN_REVIEW", () => {
    expect(isTicketStatusTransitionAllowed(TicketStatus.OPEN, TicketStatus.IN_REVIEW)).toBe(true);
});
```

RED:
- Comando: `pnpm exec vitest run tests/ticket-status-transition.policy.test.ts`.
- Resultado: exit 1; suite falló al importar el archivo aún inexistente; 0 tests.
- Error observado: `Cannot find module '../src/modules/ticket/ticket-status-transition.policy.js'`.

GREEN:
- Cambio mínimo: se creó `src/modules/ticket/ticket-status-transition.policy.ts` con una sola transición permitida para `OPEN` y resultado `false` como valor por defecto.
- Fragmento: `allowedTransitions[TicketStatus.OPEN] = [TicketStatus.IN_REVIEW]`; la función consulta `.includes(nextStatus)`.
- Archivos involucrados: se creó la política; `tests/ticket-status-transition.policy.test.ts` contiene la prueba.
- Comando: `pnpm exec vitest run tests/ticket-status-transition.policy.test.ts`.
- Resultado observado: exit 0; 1 test pasó.

REFACTOR:
- No se anticipó estructura para transiciones todavía no cubiertas: no simplificaba el caso ni aclaraba el nombre o la estructura.
- Comportamiento: sin cambio de código.
- Comando: `pnpm exec vitest run tests/ticket-status-transition.policy.test.ts`.
- Resultado observado: exit 0; 1 test pasó.

Resultado: cubierta `OPEN -> IN_REVIEW`.

### Prueba 2 — permite las otras salidas de OPEN y rechaza COMPLETED

Objetivo: cubrir las otras dos transiciones permitidas desde `OPEN` y dejar explícito que `OPEN -> COMPLETED` no está permitida.

Preparación: la política solamente permitía `OPEN -> IN_REVIEW`; se agregó una sola prueba:

```ts
it("permite OPEN -> IN_PROGRESS y OPEN -> CANCELLED, pero no OPEN -> COMPLETED", () => {
    expect(isTicketStatusTransitionAllowed(TicketStatus.OPEN, TicketStatus.IN_PROGRESS)).toBe(true);
    expect(isTicketStatusTransitionAllowed(TicketStatus.OPEN, TicketStatus.CANCELLED)).toBe(true);
    expect(isTicketStatusTransitionAllowed(TicketStatus.OPEN, TicketStatus.COMPLETED)).toBe(false);
});
```

RED:
- Comando: `pnpm exec vitest run tests/ticket-status-transition.policy.test.ts -t 'permite OPEN -> IN_PROGRESS'`.
- Resultado observado: exit 1; 1 test falló y el primer test se omitió.
- Error relevante: la expectativa `OPEN -> IN_PROGRESS` recibió `false` en lugar de `true`; la prueba se detuvo antes de evaluar las otras dos expectativas.

GREEN:
- Cambio mínimo: se agregaron `IN_PROGRESS` y `CANCELLED` a los destinos permitidos desde `OPEN`.
- Fragmento de regla incorporada: `OPEN: [IN_REVIEW, IN_PROGRESS, CANCELLED]`.
- Archivos involucrados: se amplió `src/modules/ticket/ticket-status-transition.policy.ts` y se agregó el caso a `tests/ticket-status-transition.policy.test.ts`.
- Comando: `pnpm exec vitest run tests/ticket-status-transition.policy.test.ts -t 'permite OPEN -> IN_PROGRESS'`.
- Resultado observado: exit 0; 1 test pasó y el primero se omitió.

REFACTOR:
- Se hizo inmutable por tipo la lista de transiciones (`readonly TicketStatus[]`), evitando mutaciones accidentales de la política sin alterar su resultado.
- Comportamiento: no cambió.
- Comando: `pnpm exec vitest run tests/ticket-status-transition.policy.test.ts -t 'permite OPEN -> IN_PROGRESS'`.
- Resultado observado: exit 0; 1 test pasó y el primero se omitió.

Resultado: cubiertas las tres salidas permitidas de `OPEN` y el rechazo de `OPEN -> COMPLETED`.

### Prueba 3 — permite avanzar o cancelar desde IN_REVIEW, pero no reabrir

Objetivo: verificar las dos salidas de `IN_REVIEW` del baseline y el rechazo de `IN_REVIEW -> OPEN`.

Preparación: solo `OPEN` tenía entradas en la tabla parcial. Se agregó una prueba:

```ts
it("permite IN_REVIEW -> IN_PROGRESS y CANCELLED, pero no reabrir a OPEN", () => {
    expect(isTicketStatusTransitionAllowed(TicketStatus.IN_REVIEW, TicketStatus.IN_PROGRESS)).toBe(true);
    expect(isTicketStatusTransitionAllowed(TicketStatus.IN_REVIEW, TicketStatus.CANCELLED)).toBe(true);
    expect(isTicketStatusTransitionAllowed(TicketStatus.IN_REVIEW, TicketStatus.OPEN)).toBe(false);
});
```

RED:
- Comando: `pnpm exec vitest run tests/ticket-status-transition.policy.test.ts -t 'IN_REVIEW -> IN_PROGRESS'`.
- Resultado observado: exit 1; 1 test falló y 2 se omitieron.
- Error relevante: `IN_REVIEW -> IN_PROGRESS` recibió `false` en lugar de `true`.

GREEN:
- Cambio mínimo: se agregó `IN_REVIEW` con destinos `IN_PROGRESS` y `CANCELLED`.
- Fragmento de regla incorporada: `IN_REVIEW: [IN_PROGRESS, CANCELLED]`.
- Archivos involucrados: se amplió `src/modules/ticket/ticket-status-transition.policy.ts` y se agregó el caso a `tests/ticket-status-transition.policy.test.ts`.
- Comando: `pnpm exec vitest run tests/ticket-status-transition.policy.test.ts -t 'IN_REVIEW -> IN_PROGRESS'`.
- Resultado observado: exit 0; 1 test pasó y 2 se omitieron.

REFACTOR:
- Se conservó la tabla parcial e inmutable; hacerla exhaustiva ahora implementaría estados todavía no probados.
- Comportamiento: sin cambio de código.
- Comando: `pnpm exec vitest run tests/ticket-status-transition.policy.test.ts -t 'IN_REVIEW -> IN_PROGRESS'`.
- Resultado observado: exit 0; 1 test pasó y 2 se omitieron.

Resultado: cubiertas las salidas permitidas de `IN_REVIEW` y su retroceso rechazado.

### Prueba 4 — permite completar desde IN_PROGRESS y rechaza salida desde COMPLETED

Objetivo: cubrir `IN_PROGRESS -> COMPLETED` y confirmar que el estado terminal no vuelve a `IN_PROGRESS`.

Preparación: la tabla parcial tenía las entradas de `OPEN` e `IN_REVIEW`, pero todavía no una entrada para `IN_PROGRESS`. Se agregó una prueba:

```ts
it("permite IN_PROGRESS -> COMPLETED, pero COMPLETED no vuelve a IN_PROGRESS", () => {
    expect(isTicketStatusTransitionAllowed(TicketStatus.IN_PROGRESS, TicketStatus.COMPLETED)).toBe(true);
    expect(isTicketStatusTransitionAllowed(TicketStatus.COMPLETED, TicketStatus.IN_PROGRESS)).toBe(false);
});
```

RED:
- Comando: `pnpm exec vitest run tests/ticket-status-transition.policy.test.ts -t 'IN_PROGRESS -> COMPLETED'`.
- Resultado observado: exit 1; 1 test falló y 3 se omitieron.
- Error relevante: `IN_PROGRESS -> COMPLETED` recibió `false` en lugar de `true`.

GREEN:
- Cambio mínimo: se agregó `IN_PROGRESS -> COMPLETED` a la tabla.
- Fragmento de regla incorporada: `IN_PROGRESS: [COMPLETED]` en el estado de la política de ese ciclo.
- Archivos involucrados: se amplió `src/modules/ticket/ticket-status-transition.policy.ts` y se agregó el caso a `tests/ticket-status-transition.policy.test.ts`.
- Comando: `pnpm exec vitest run tests/ticket-status-transition.policy.test.ts -t 'IN_PROGRESS -> COMPLETED'`.
- Resultado observado: exit 0; 1 test pasó y 3 se omitieron.

REFACTOR:
- Se mantuvo la tabla parcial e inmutable; la salida `IN_PROGRESS -> CANCELLED` se reserva para el siguiente ciclo.
- Comportamiento: sin cambio de código.
- Comando: `pnpm exec vitest run tests/ticket-status-transition.policy.test.ts -t 'IN_PROGRESS -> COMPLETED'`.
- Resultado observado: exit 0; 1 test pasó y 3 se omitieron.

Resultado: cubierta la finalización válida y el rechazo de salida desde `COMPLETED`.

### Prueba 5 — permite cancelar desde IN_PROGRESS y rechaza salida desde CANCELLED

Objetivo: cubrir la transición restante de `IN_PROGRESS` y verificar que el estado terminal `CANCELLED` no vuelve a `OPEN`.

Preparación: la tabla parcial permitía completar desde `IN_PROGRESS`, pero todavía no cancelar. Se agregó una prueba:

```ts
it("permite IN_PROGRESS -> CANCELLED, pero CANCELLED no vuelve a OPEN", () => {
    expect(isTicketStatusTransitionAllowed(TicketStatus.IN_PROGRESS, TicketStatus.CANCELLED)).toBe(true);
    expect(isTicketStatusTransitionAllowed(TicketStatus.CANCELLED, TicketStatus.OPEN)).toBe(false);
});
```

RED:
- Comando: `pnpm exec vitest run tests/ticket-status-transition.policy.test.ts -t 'IN_PROGRESS -> CANCELLED'`.
- Resultado observado: exit 1; 1 test falló y 4 se omitieron.
- Error relevante: `IN_PROGRESS -> CANCELLED` recibió `false` en lugar de `true`.

GREEN:
- Cambio mínimo: se añadió `CANCELLED` a los destinos permitidos desde `IN_PROGRESS`.
- Fragmento de regla incorporada: `IN_PROGRESS: [COMPLETED, CANCELLED]`.
- Archivos involucrados: se amplió `src/modules/ticket/ticket-status-transition.policy.ts` y se agregó el caso a `tests/ticket-status-transition.policy.test.ts`.
- Comando: `pnpm exec vitest run tests/ticket-status-transition.policy.test.ts -t 'IN_PROGRESS -> CANCELLED'`.
- Resultado observado: exit 0; 1 test pasó y 4 se omitieron.

REFACTOR:
- Se cambió la tabla de parcial a exhaustiva: `Record<TicketStatus, readonly TicketStatus[]>`; `COMPLETED` y `CANCELLED` se declararon con listas vacías y la consulta ya no requiere fallback opcional.
- Motivo: hacer explícitos los cinco estados del enum y detectar por tipos un estado omitido; las reglas de terminalidad siguen representadas por listas vacías.
- Comportamiento: sin cambio para los estados del enum. El comando ejercitó los cinco tests, incluidos los rechazos desde ambos terminales.
- Comando: `pnpm exec vitest run tests/ticket-status-transition.policy.test.ts`.
- Resultado observado: exit 0; 5 tests pasaron.

Resultado: la política cubre las siete transiciones permitidas existentes y rechaza los casos terminales comprobados.

## Resumen cronológico

| Prueba | RED | GREEN | REFACTOR | Resultado |
|---|---|---|---|---|
| 1. `OPEN -> IN_REVIEW` | Módulo inexistente; import falló, 0 tests | 1 pasó | Sin cambio; 1 pasó | Cubierta |
| 2. otras salidas de `OPEN`; no `COMPLETED` | `OPEN -> IN_PROGRESS` recibió false | 1 pasó | Lista `readonly`; 1 pasó | Cubiertas |
| 3. salidas y retroceso de `IN_REVIEW` | `IN_REVIEW -> IN_PROGRESS` recibió false | 1 pasó | Sin cambio; 1 pasó | Cubiertas |
| 4. completar y terminal `COMPLETED` | `IN_PROGRESS -> COMPLETED` recibió false | 1 pasó | Sin cambio; 1 pasó | Cubiertas |
| 5. cancelar y terminal `CANCELLED` | `IN_PROGRESS -> CANCELLED` recibió false | 1 pasó | Tabla exhaustiva; 5 pasaron | Cubiertas |

## Integración y observaciones técnicas

### Integración en el servicio

- En `src/modules/ticket/ticket.service.ts` se eliminó la tabla local y se importó `isTicketStatusTransitionAllowed` desde la política aislada.
- El control sigue ejecutándose después de `assertActive(ticket)`. La condición conserva `status !== ticket.status`, por lo que solicitar el estado actual continúa siendo un no-op idempotente sin consultar la política.
- Se mantiene el error `409 INVALID_STATUS_TRANSITION` y su mensaje para transiciones distintas no autorizadas. No se modificaron rutas, respuestas, persistencia, Prisma, migraciones ni otros módulos.

### Verificaciones de integración y finales

- Política y pruebas unitarias del servicio: `pnpm exec vitest run tests/ticket-status-transition.policy.test.ts tests/ticket.unit.test.ts` — **2 archivos, 11 tests pasaron**.
- Regresión PostgreSQL del flujo de estado: `DATABASE_URL_TEST='postgresql://samael@localhost:5432/support_system_test?host=/var/run/postgresql' pnpm exec vitest run tests/ticket.postgres.integration.test.ts -t 'estado respeta área, asignación, transición, cancelación y timestamps terminales'` — **1 pasó, 91 omitidas por el filtro**. Se ejecutó contra la base local `support_system_test`.
- Suite completa: `DATABASE_URL_TEST='postgresql://samael@localhost:5432/support_system_test?host=/var/run/postgresql' pnpm test` — **11 archivos; 220 pasaron y 1 falló (221 total)**. El único fallo fue `tests/ticket.postgres.integration.test.ts` / `mantiene asignación y evento tras fallo SMTP, guarda backoff, y cierra en FAILED al agotar intentos`: esperaba `attempts: 1` y recibió `0`. En esa prueba se usa el reloj fijo `2026-10-05T05:30:00Z`, mientras que la notificación disponible se crea con la hora de ejecución (2026-10-17); con ese reloj no resulta elegible. Este caso es de reintentos de notificación y no de política de transición.
- `pnpm exec tsc --noEmit` — **exit 0**.
- `pnpm build` — **exit 0** (`tsc`).
- `git diff --check` — **exit 0**.
- `pnpm audit` — **exit 1**; reportó una vulnerabilidad crítica transitiva de `proxy-addr` (rangos afectados `>=1.1.0 <2.0.8`, parche desde `2.0.8`), alcanzable por dependencias como `express`, `express-rate-limit` y `swagger-ui-express`. No se actualizaron dependencias, fuera del alcance de este cambio.

### Observaciones técnicas para el reporte académico

- Antes del cambio, la regla de transición estaba acoplada al servicio; la extracción permite probarla como función pura, sin HTTP ni base de datos.
- Los cinco ciclos añadieron expectativas en incrementos: cada nuevo arco permitido produjo un RED por recibir `false`, seguido de GREEN al incorporar únicamente la regla necesaria. Los ciclos 3 y 4 conservaron la estructura parcial durante REFACTOR porque no había una simplificación justificada todavía.
- El refactor final hizo exhaustiva la tabla con `Record<TicketStatus, readonly TicketStatus[]>`; los dos estados terminales tienen listas vacías y ya no hace falta fallback en la consulta.
- La política decide únicamente si un par de estados distintos está permitido. La comprobación de ticket activo y el tratamiento idempotente del mismo estado permanecen en el servicio.
- Las expectativas negativas añadidas cubren `OPEN -> COMPLETED`, `IN_REVIEW -> OPEN`, `COMPLETED -> IN_PROGRESS` y `CANCELLED -> OPEN`; los resultados falsos para esos pares evitan que la política autorice esos retrocesos/cierres.
- El costo observable de escribir primero cada caso fue ejecutar en secuencia un RED, un GREEN y un REFACTOR por ciclo, además de conservar las pruebas anteriores. No se registraron duraciones de ejecución.
- La integración sustituyó una tabla local por una importación y una llamada, sin cambiar el orden de validación ni el bloque de error; la verificación de PostgreSQL seleccionada pasó después de la extracción.
- La regresión de PostgreSQL del flujo de estado pasó. La suite completa también reveló el fallo de reloj descrito arriba, independiente del módulo modificado. El chequeo de dependencias reportó además la vulnerabilidad transitiva indicada.

### Archivos del cambio

- Modificado: `src/modules/ticket/ticket.service.ts`.
- Creado: `src/modules/ticket/ticket-status-transition.policy.ts`.
- Creado: `tests/ticket-status-transition.policy.test.ts`.
- Creado: `docs/TDD_BACKEND_EVIDENCE.md`.

No se creó ningún commit ni se hizo push durante esta ejecución.

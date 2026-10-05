# Notificaciones y correo

## Transactional Outbox

Las asignaciones escriben el nuevo `assigneeId`, `TicketEvent ASSIGNED` y una fila `NotificationOutbox` de tipo `TICKET_ASSIGNED` dentro de una sola transacción PostgreSQL. Si falla la inserción del outbox, se revierten también asignación y evento. La petición no espera a SMTP: una respuesta exitosa confirma que la asignación y la notificación quedaron persistidas, no que el correo llegó.

El correo se envía después del commit. Un error SMTP deja intacto el ticket y programa otro intento. No hay endpoint público para procesar o reenviar notificaciones.

## Estados

- `PENDING`: listo cuando `availableAt <= now` y quedan intentos.
- `PROCESSING`: reservado por un worker, con `lockedAt` y `lockedBy`.
- `SENT`: Nodemailer aceptó el envío y se guardó `sentAt`.
- `FAILED`: alcanzó `NOTIFICATION_MAX_ATTEMPTS`.
- `SKIPPED`: recordatorio obsoleto que ya no cumple elegibilidad.

El worker reclama hasta `NOTIFICATION_BATCH_SIZE` filas por orden de `availableAt`, `createdAt` e ID con `FOR UPDATE SKIP LOCKED`. El claim incrementa `attempts`, asigna un lease y confirma una transacción corta. La llamada SMTP ocurre después y fuera de cualquier transacción. El lease vence después de `NOTIFICATION_LOCK_TIMEOUT_MS`; una instancia puede recuperar claims abandonados. Claims vencidos que ya agotaron intentos pasan a FAILED.

Los fallos regresan a PENDING con retrasos de 1, 5, 15 y 30 minutos; el último valor se repite como tope. Cuando se alcanza el máximo, no se reintenta automáticamente. `lastError` se limpia de usuario/contraseña SMTP y direcciones de correo, se limita a 500 caracteres y nunca se incluye en logs.

El claim evita envíos simultáneos del mismo outbox entre instancias. SMTP y PostgreSQL no comparten una transacción: si SMTP acepta el correo y el proceso se cae antes de persistir SENT, la recuperación del lease puede repetirlo. El sistema prioriza entrega al menos una vez en esa ventana incierta.

## Transporte SMTP

La aplicación usa Nodemailer con SMTP genérico. Los mensajes incluyen texto plano y HTML sencillo; el HTML escapa los valores del ticket. No se incluyen datos del reportero, JWT ni enlaces firmados. `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` y `SMTP_FROM` configuran el transporte. `SMTP_USER` y `SMTP_PASSWORD` deben estar ambos presentes o ambos ausentes; cuando se usan, nunca se escriben en logs.

En producción, si `NOTIFICATION_WORKER_ENABLED=true`, se requieren `SMTP_HOST` y `SMTP_FROM`. La falta de credenciales no bloquea `pnpm test`; el worker y el job se pueden desactivar en `.env`. Las conexiones tienen timeouts inferiores al lease predeterminado.

Variables del proceso:

| Variable | Función |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | Servidor y conexión TLS |
| `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Autenticación opcional y remitente |
| `NOTIFICATION_WORKER_ENABLED` | Activa el procesador de outbox |
| `NOTIFICATION_WORKER_INTERVAL_MS` | Intervalo de lectura del outbox |
| `NOTIFICATION_BATCH_SIZE` | Máximo de filas reclamadas por ejecución |
| `NOTIFICATION_MAX_ATTEMPTS` | Máximo de intentos antes de FAILED |
| `NOTIFICATION_LOCK_TIMEOUT_MS` | Duración del lease recuperable |
| `REMINDER_JOB_ENABLED` | Activa la generación periódica de recordatorios |
| `REMINDER_CHECK_INTERVAL_MS` | Intervalo de búsqueda de tickets vencidos |

El ejemplo sin secretos está en `.env.example`. `pnpm test` usa un transporte falso y no contacta un SMTP real.

## Asignaciones notificadas

Se crea `TICKET_ASSIGNED` cuando SUPPORT/SUB_MANAGER gana una autoasignación, ADMIN asigna un ticket sin responsable o ADMIN reasigna a otra persona. El destinatario siempre es el nuevo responsable. Repetir el mismo asignado no crea un evento ni otro outbox; retirar asignación y los fallos de asignación no envían correo.

La clave de deduplicación de asignación contiene ticket y UUID único de la operación, por lo que bloquea duplicados accidentales de una operación y permite futuras reasignaciones legítimas al mismo técnico. El payload tiene solo código/título, prioridad, edificio/aula y nombre actual del técnico.

## Recordatorios

`REMINDER_JOB_ENABLED=true` ejecuta el job en el proceso del backend al iniciar y luego con `REMINDER_CHECK_INTERVAL_MS`. Encola, pero nunca envía SMTP directamente. Admite tickets activos de al menos siete días completos, asignados a una cuenta activa SUPPORT/SUB_MANAGER. Los tickets sin asignar y los asignados a una cuenta inactiva no generan recordatorio.

La clave única `ticket-reminder:{ticketId}:{fecha-local}` usa el día calculado con `APP_TIMEZONE`. El índice UNIQUE existente en `dedupeKey` hace idempotentes jobs simultáneos; una fecha local posterior puede producir otro recordatorio. Antes de enviar, el worker confirma que el ticket sigue activo y asignado al mismo destinatario activo. Si se cerró o reasignó, marca SKIPPED sin enviar.

## Operación y pruebas manuales

1. Configura las variables SMTP en `.env` local; no las guardes en Git ni las compartas en logs.
2. Inicia la API normalmente. Comprueba que los flags estén activos y realiza una asignación normal desde la aplicación.
3. Revisa `NotificationOutbox` en la base local y los logs estructurados por `notificationId`, `type`, `ticketId`, `attempt` y resultado; no se registra el destinatario ni el cuerpo del correo.
4. Para simular una falla, detén temporalmente el servidor SMTP configurado. El outbox debe pasar de PROCESSING a PENDING con `availableAt` futuro y, al alcanzar el máximo, a FAILED. El ticket asignado permanece sin cambios.
5. La suite automatizada prueba el flujo con `support_system_test` y un `FakeMailTransport`; no envía correos reales. La prueba manual con credenciales reales queda pendiente de configurar el servidor SMTP institucional.

Los endpoints `/health` y `/ready` no consultan SMTP. Un servidor de correo caído degrada la entrega de avisos, pero no cambia la disponibilidad de la API ni sus asignaciones.

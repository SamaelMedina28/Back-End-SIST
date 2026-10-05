# Catálogo de errores de API

Las respuestas de error siguen el envelope del backend: `success: false`, `error.code`, `error.message`, `requestId` y, para validaciones, `error.fields`. Los mensajes son para personas; los clientes deben decidir por `code` y no por el texto localizado. Nunca se devuelven stacks ni mensajes crudos de Prisma, Google, JWT o SMTP.

| Código | HTTP habitual | Significado / respuesta sugerida |
|---|---:|---|
| `AUTHENTICATION_REQUIRED` | 401 | Falta una sesión válida; iniciar OAuth. |
| `INVALID_SESSION`, `ONBOARDING_REQUIRED`, `ONBOARDING_EXPIRED` | 401 | Sesión/cookie temporal inválida o vencida; reiniciar el flujo de acceso. |
| `USER_DISABLED` | 403 | La cuenta fue desactivada; no reintentar automáticamente. |
| `FORBIDDEN` | 403 | El rol no permite la operación. |
| `FORBIDDEN_TICKET` | 403 | El ticket existe, pero está fuera del ámbito visible. |
| `SUPPORT_AREA_FORBIDDEN`, `TICKET_NOT_ASSIGNED_TO_YOU` | 403 | La operación excede el área o la asignación del actor. |
| `EMAIL_DOMAIN_NOT_ALLOWED`, `EMAIL_NOT_VERIFIED` | 403 | La identidad no satisface la política institucional configurada. |
| `GOOGLE_IDENTITY_INVALID`, `GOOGLE_AUTHENTICATION_FAILED` | 401 | Google no pudo validarse; reiniciar OAuth. |
| `OAUTH_CODE_MISSING`, `OAUTH_STATE_INVALID` | 400 | Callback incompleto o state no coincide; reiniciar OAuth. |
| `GOOGLE_ACCOUNT_CONFLICT` | 409 | El correo está vinculado a otra identidad Google; requiere soporte administrativo. |
| `EMAIL_ALREADY_REGISTERED`, `INSTITUTIONAL_ID_ALREADY_REGISTERED` | 409 | El correo o identificador institucional ya existe. |
| `VALIDATION_ERROR` | 422 | Body, parámetro, query o encabezado inválido; mostrar `error.fields`. |
| `ROUTE_NOT_FOUND` | 404 | Ruta no registrada. |
| `CATEGORY_NOT_FOUND`, `SUBCATEGORY_NOT_FOUND`, `ACTIVITY_LOG_NOT_FOUND`, `INVENTORY_ITEM_NOT_FOUND`, `SUPPORT_MEMBER_NOT_FOUND`, `TICKET_NOT_FOUND`, `ASSIGNEE_NOT_FOUND`, `PARTICIPANT_NOT_FOUND` | 404 | Recurso inexistente o referencia no encontrada. |
| `CATEGORY_INACTIVE`, `SUBCATEGORY_INACTIVE`, `INVENTORY_ITEM_INACTIVE`, `ASSIGNEE_INACTIVE`, `PARTICIPANT_INACTIVE` | 409 | El recurso existe, pero no puede usarse en la operación solicitada. |
| `CATEGORY_CODE_ALREADY_EXISTS`, `SUBCATEGORY_CODE_ALREADY_EXISTS`, `INVENTORY_ASSET_CODE_ALREADY_EXISTS`, `INVENTORY_SERIAL_NUMBER_ALREADY_EXISTS` | 409 | Valor único ya registrado; solicitar uno distinto. |
| `SUBCATEGORY_CATEGORY_MISMATCH` | 422 | La subcategoría no pertenece a la categoría elegida. |
| `TICKET_PRIORITY_NOT_CONFIGURED` | 409 | No hay prioridad efectiva en categoría/subcategoría; requiere configuración administrativa. |
| `DUPLICATE_TICKET` | 409 | Ya existe un ticket activo de la misma categoría y ubicación normalizada; la subcategoría no diferencia la clave. |
| `ACTIVE_TICKET_LIMIT_REACHED` | 409 | El usuario alcanzó el máximo de 10 tickets activos. |
| `SOFTWARE_REQUEST_REQUIRES_TEACHER` | 403 | Solo una cuenta TEACHER puede crear esa solicitud de software. |
| `INVALID_STATUS_TRANSITION`, `TICKET_NOT_ACTIVE`, `TICKET_STATE_NOT_ALLOWED_FOR_ACTIVITY` | 409 | La transición/actividad no es válida para el estado actual. |
| `TICKET_ALREADY_ASSIGNED`, `ASSIGNEE_AREA_MISMATCH`, `INVALID_ASSIGNEE_ROLE` | 409 | Asignación conflictiva o destino no elegible/compatible; revisar ticket y técnico. |
| `IDEMPOTENCY_CONFLICT` | 409 | La clave ya se usó con un body distinto; usar una nueva clave para otra operación. |
| `SUPPORT_MEMBER_HAS_ACTIVE_TICKETS` | 409 | No se puede desactivar al técnico mientras tenga tickets activos asignados. |
| `INVALID_ACTIVITY_PARTICIPANT_ROLE` | 409 | El participante no pertenece al equipo de soporte permitido para la bitácora. |
| `RATE_LIMIT_EXCEEDED` | 429 | Se excedió el límite temporal de OAuth/onboarding; esperar antes de reintentar. |
| `INTERNAL_ERROR` | 500 | Error inesperado; conservar `requestId` para diagnóstico y no repetir operaciones de escritura a ciegas. |

Los códigos se originan en `AppError`, el middleware Zod y el middleware de rutas no encontradas. La lista anterior cubre los códigos de dominio y comunes encontrados en el backend al cierre de la auditoría; los endpoints y sus casos HTTP específicos se documentan en [API.md](API.md) y en el OpenAPI servido por `/api/openapi.json`.

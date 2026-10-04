# API del sistema de soporte técnico

La API funcional usa el prefijo `/api/v1`. Las respuestas JSON exitosas siguen `{ "success": true, "data": ... }`; los errores incluyen `success`, `error` y `requestId`. Todas las rutas descritas aquí requieren una sesión por cookie salvo el inicio/callback OAuth y `complete-profile`, que requiere la cookie de onboarding.

## Autenticación

### `GET /api/v1/auth/google`

- Rol: público.
- Request: navegación del navegador, sin body.
- Response: `302` hacia Google.
- Errores: `429 RATE_LIMIT_EXCEEDED`.

```ts
window.location.href = `${API_URL}/api/v1/auth/google`;
```

### `GET /api/v1/auth/google/callback`

- Rol: callback OAuth, protegido por `state` y PKCE.
- Request: query `code` y `state` enviados por Google.
- Response: `302` hacia `/auth/success` o `/auth/complete-profile` del frontend.
- Errores: `400 OAUTH_CODE_MISSING`, `401 OAUTH_STATE_INVALID`, `403` por correo/dominio, `409 GOOGLE_ACCOUNT_CONFLICT`, `429 RATE_LIMIT_EXCEEDED`.

### `POST /api/v1/auth/complete-profile`

- Rol: onboarding válido mediante cookie HTTP-only.
- Request:

```json
{
  "institutionalId": "1287456",
  "communityType": "STUDENT",
  "phone": null
}
```

- Response: `201` con usuario público y cookie de sesión.
- Errores: `401 ONBOARDING_REQUIRED` / `ONBOARDING_EXPIRED`, `409 EMAIL_ALREADY_REGISTERED` / `INSTITUTIONAL_ID_ALREADY_REGISTERED`, `422 VALIDATION_ERROR`.

### `GET /api/v1/auth/me`

- Rol: cualquier usuario autenticado.
- Request: cookie de sesión.
- Response: `200` con el perfil público actual.
- Errores: `401 AUTHENTICATION_REQUIRED` / `INVALID_SESSION`, `403 USER_DISABLED`.

### `POST /api/v1/auth/logout`

- Rol: sesión opcional; operación idempotente.
- Request: sin body.
- Response: `204 No Content`.

### `PATCH /api/v1/users/me`

- Rol: cualquier usuario autenticado.
- Request: solo `fullName` y/o `phone`.
- Response: `200` con el perfil actualizado.
- Errores: `401`, `403 USER_DISABLED`, `422 VALIDATION_ERROR`.

```ts
await api("/users/me", {
  method: "PATCH",
  body: JSON.stringify({ fullName: "Nombre Apellido", phone: null }),
});
```

## Categorías

Los códigos se validan como `UPPER_SNAKE_CASE` y quedan estables. Los listados se ordenan por nombre ascendente; las subcategorías se ordenan igual. Las prioridades pueden ser `null` y nunca se reemplazan por un valor inventado. Cuando ambas prioridades son nulas, la prioridad efectiva sigue siendo `null`.

### `GET /api/v1/categories`

- Rol: cualquier usuario autenticado.
- Query: `includeInactive=true` es exclusivo de `ADMIN`; otros roles reciben `403 FORBIDDEN`.
- Response: `200` con categorías visibles y subcategorías activas. `includeInactive=true` también incluye categorías inactivas, pero no cambia el filtro de subcategorías.
- Errores: `401`, `403`, `422 VALIDATION_ERROR`.

### `POST /api/v1/categories`

- Rol: `ADMIN`.
- Request:

```json
{
  "code": "PROJECTOR_FAILURE",
  "name": "Falla de proyector",
  "supportArea": "HARDWARE",
  "defaultPriority": null,
  "requiresSoftwareDetails": false
}
```

- Response: `201` con categoría creada.
- Errores: `401`, `403`, `409 CATEGORY_CODE_ALREADY_EXISTS`, `422 VALIDATION_ERROR`.

### `PATCH /api/v1/categories/:id`

- Rol: `ADMIN`.
- Request: campos parciales entre `name`, `supportArea`, `defaultPriority`, `requiresSoftwareDetails` e `isActive`. `code`, IDs y timestamps no se aceptan.
- Response: `200` con categoría actualizada.
- Errores: `401`, `403`, `404 CATEGORY_NOT_FOUND`, `422 VALIDATION_ERROR`.

### `DELETE /api/v1/categories/:id`

- Rol: `ADMIN`.
- Request: UUID en el path.
- Response: `204`; establece `isActive=false` y es idempotente. No elimina subcategorías ni registros históricos.
- Errores: `401`, `403`, `404 CATEGORY_NOT_FOUND`, `422 VALIDATION_ERROR`.

### `POST /api/v1/categories/:categoryId/subcategories`

- Rol: `ADMIN`.
- Request: `{ "code": "CONNECTION_FAILURE", "name": "Falla de conexión", "priority": "HIGH" }`. `priority` puede ser `null` u omitirse.
- Response: `201` con subcategoría.
- Errores: `401`, `403`, `404 CATEGORY_NOT_FOUND`, `409 CATEGORY_INACTIVE` / `SUBCATEGORY_CODE_ALREADY_EXISTS`, `422 VALIDATION_ERROR`.

### `PATCH /api/v1/subcategories/:id`

- Rol: `ADMIN`.
- Request: campos parciales entre `name`, `priority` e `isActive`. No permite cambiar `code`, `categoryId`, IDs ni timestamps.
- Response: `200` con subcategoría actualizada.
- Errores: `401`, `403`, `404 SUBCATEGORY_NOT_FOUND`, `422 VALIDATION_ERROR`.

### `DELETE /api/v1/subcategories/:id`

- Rol: `ADMIN`.
- Request: UUID en el path.
- Response: `204`; establece `isActive=false` y es idempotente.
- Errores: `401`, `403`, `404 SUBCATEGORY_NOT_FOUND`, `422 VALIDATION_ERROR`.

## Catálogo

### `GET /api/v1/catalog/ticket-form`

- Rol: cualquier usuario autenticado.
- Request: sin parámetros.
- Response: `200` con categorías/subcategorías activas y `maxActiveTickets: 10`.
- Errores: `401`.

```json
{
  "success": true,
  "data": {
    "categories": [],
    "maxActiveTickets": 10
  }
}
```

El contenido procede de PostgreSQL; las prioridades nulas se conservan. La API aún no crea tickets ni aplica el límite.

### `GET /api/v1/catalog/support-suggestions`

- Rol: cualquier usuario autenticado.
- Query obligatoria: `categoryId` UUID. Query opcional: `subcategoryId` UUID.
- Response: `200` con sugerencias activas o `[]` si todavía no hay contenido. Con subcategoría se incluyen sugerencias generales de la categoría y las específicas de esa subcategoría.
- Errores: `401`, `404 CATEGORY_NOT_FOUND` / `SUBCATEGORY_NOT_FOUND`, `422 VALIDATION_ERROR`.

No se sembraron sugerencias ficticias. El endpoint devuelve `[]` hasta que existan filas activas cargadas en la tabla.

## Documentación interactiva

- Swagger UI: `GET /api/docs`
- OpenAPI JSON: `GET /api/openapi.json`

El documento describe las rutas implementadas de auth, perfil, catálogo, categorías, subcategorías y health/readiness. No publica rutas de tickets ni de módulos futuros.

## Ejemplo del helper frontend

```ts
await api("/catalog/ticket-form");
await api("/categories");
await api(`/catalog/support-suggestions?categoryId=${categoryId}&subcategoryId=${subcategoryId}`);
```

La gestión de categorías/subcategorías requiere `ADMIN`; los usuarios ordinarios solo consultan el catálogo activo.

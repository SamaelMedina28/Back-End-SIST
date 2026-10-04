# Autenticación, sesión y autorización

## Decisión de arquitectura

Express controla Google OAuth y emite una sesión propia. No se usa NextAuth porque el frontend es independiente y el backend debe ser la autoridad sobre identidad, onboarding, usuarios activos, roles y áreas de soporte.

Google se utiliza solamente como proveedor de identidad. La aplicación no persiste access tokens, refresh tokens ni ID tokens de Google.

## Flujo Google OAuth

1. El frontend navega a `GET /api/v1/auth/google`.
2. Express genera `state`, un verificador PKCE y su challenge.
3. `state` y el verificador se guardan temporalmente en cookies HTTP-only.
4. Google devuelve `code` y `state` al callback.
5. Express consume y elimina las cookies temporales, valida state, intercambia el code y verifica el ID token.
6. Se exige correo verificado y un dominio incluido exactamente en `ALLOWED_EMAIL_DOMAINS`.

Los scopes solicitados son exclusivamente `openid`, `email` y `profile`. No se solicita acceso offline.

## Usuario existente

Si `googleSubject` coincide con un User activo, se actualizan `lastLoginAt` y el avatar, se crea una sesión propia y se redirige a:

```text
FRONTEND_URL/auth/success
```

Si el usuario existe por email y `googleSubject` es null, se vincula de forma atómica. Se conservan role, supportAreas y skills, por lo que un SUPPORT o SUB_MANAGER pre-provisionado no se convierte en USER.

Si el email ya está vinculado a otro `googleSubject`, se rechaza con `GOOGLE_ACCOUNT_CONFLICT`.

## Usuario nuevo y onboarding

El callback no crea User. Emite una cookie temporal firmada con purpose `onboarding` y redirige a:

```text
FRONTEND_URL/auth/complete-profile
```

El frontend envía únicamente:

```json
{
  "institutionalId": "1287456",
  "communityType": "STUDENT",
  "phone": null
}
```

`POST /api/v1/auth/complete-profile` verifica expiración y purpose, crea el User completo con role USER, crea la sesión y elimina el onboarding. Las restricciones únicas de PostgreSQL protegen solicitudes repetidas o concurrentes.

## Cookies

- `sist_oauth_state`: state OAuth, HTTP-only, SameSite Lax, aproximadamente 10 minutos, limitada al callback.
- `sist_oauth_pkce`: verificador PKCE, misma duración y alcance.
- `sist_onboarding`: JWT temporal con purpose onboarding, aproximadamente 15 minutos, limitada a complete-profile.
- `SESSION_COOKIE_NAME` — normalmente `sist_session`: JWT propio con purpose session, aproximadamente un día, path raíz.

Todas usan `Secure` en producción. Ningún JWT se devuelve en JSON.

## Sesión y /auth/me

El JWT de sesión contiene como mínimo `sub`, `email` y `purpose = session`. En cada petición protegida el middleware consulta PostgreSQL y comprueba que el usuario exista y continúe activo; la autorización no depende de un role almacenado en el JWT.

`GET /api/v1/auth/me` devuelve solamente el perfil público necesario para el frontend.

## Roles

- USER: operaciones propias.
- SUPPORT: atención dentro de sus áreas.
- SUB_MANAGER: capacidades de soporte y gestión operativa.
- ADMIN: administración global.

`requireRole(...roles)` responde `403 FORBIDDEN` cuando el usuario autenticado no tiene uno de los roles requeridos. La utilidad `hasSupportArea` queda disponible para reglas futuras de TicketService.

## Logout

`POST /api/v1/auth/logout` elimina sesión y cookies temporales. Es idempotente y responde `204 No Content`.

## Variables necesarias

```text
DATABASE_URL
FRONTEND_URL
JWT_SECRET
SESSION_COOKIE_NAME
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
ALLOWED_EMAIL_DOMAINS
NODE_ENV
PORT
```

`JWT_SECRET` debe ser aleatorio y tener al menos 32 caracteres. No existe valor fallback.

## Configuración en Google Cloud

Registra exactamente como Authorized redirect URI el valor de `GOOGLE_REDIRECT_URI`, por ejemplo:

```text
http://localhost:3000/api/v1/auth/google/callback
```

El origen/redirección del frontend se configura por separado mediante `FRONTEND_URL`.

## Pruebas

Los tests usan un proveedor Google falso y un repositorio de usuarios en memoria. Validan el comportamiento del backend sin credenciales reales. El flujo contra Google real queda pendiente hasta configurar las credenciales.


# Integración inicial del frontend

## URL base

Configura en el frontend:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

La API funcional usa el prefijo `/api/v1`.

## Iniciar sesión con Google

```ts
export function loginWithGoogle(): void {
  window.location.href =
    `${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/google`;
}
```

El navegador sigue la redirección a Google y vuelve al backend. No se transportan JWT ni tokens Google en JavaScript.

## Consultar la sesión

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function getCurrentUser() {
  const response = await fetch(
    `${API_URL}/api/v1/auth/me`,
    {
      credentials: "include",
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message ?? "No fue posible consultar la sesión.");
  }

  const json = await response.json();
  return json.data;
}
```

Todas las peticiones protegidas deben incluir:

```ts
credentials: "include"
```

El backend restringe CORS a `FRONTEND_URL` y permite credenciales.

## Usuario existente

```text
/auth/success
→ el frontend llama GET /api/v1/auth/me
→ recibe el User actual
→ redirige al dashboard correspondiente
```

## Usuario nuevo

```text
/auth/complete-profile
→ el frontend muestra institutionalId, communityType y phone opcional
→ POST /api/v1/auth/complete-profile con credentials: include
→ el backend crea User y sesión
→ el frontend redirige al dashboard
```

Ejemplo:

```ts
await fetch(
  `${API_URL}/api/v1/auth/complete-profile`,
  {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      institutionalId: "1287456",
      communityType: "STUDENT",
      phone: null,
    }),
  },
);
```

No envíes email, nombre, role, supportAreas, skills, avatarUrl ni googleSubject.

## Actualizar perfil

```ts
await fetch(
  `${API_URL}/api/v1/users/me`,
  {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fullName: "Nombre completo",
      phone: "6641234567",
    }),
  },
);
```

## Logout

```ts
await fetch(
  `${API_URL}/api/v1/auth/logout`,
  {
    method: "POST",
    credentials: "include",
  },
);
```

La respuesta es `204 No Content`.


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

## Helper de API

Usa una función común que envíe cookies de sesión y extraiga el campo `data`:

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (response.status === 204) return undefined as T;
  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.message ?? "Error desconocido");
  return json.data as T;
}
```

## Cargar el formulario de ticket

```ts
const catalog = await api<{
  categories: Array<{
    id: string;
    code: string;
    name: string;
    supportArea: string;
    defaultPriority: "LOW" | "MEDIUM" | "HIGH" | null;
    requiresSoftwareDetails: boolean;
    subcategories: Array<{
      id: string;
      code: string;
      name: string;
      priority: "LOW" | "MEDIUM" | "HIGH" | null;
    }>;
  }>;
  maxActiveTickets: 10;
}>("/catalog/ticket-form");
```

## Consultar categorías

```ts
const categories = await api<Array<{
  id: string;
  code: string;
  name: string;
  supportArea: string;
  defaultPriority: "LOW" | "MEDIUM" | "HIGH" | null;
  isActive: boolean;
  subcategories: Array<{ id: string; code: string; name: string; priority: string | null; isActive: boolean }>;
}>>("/categories");
```

Solo una cuenta ADMIN puede usar `?includeInactive=true` o modificar el catálogo.

## Sugerencias de soporte

```ts
const query = new URLSearchParams({ categoryId, subcategoryId });
const suggestions = await api<Array<{ id: string; title: string; description: string }>>(
  `/catalog/support-suggestions?${query}`,
);
```

`subcategoryId` es opcional. La respuesta puede ser `[]` mientras no se cargue contenido activo; no hay sugerencias de demostración.

## Crear una categoría (ADMIN)

```ts
await api("/categories", {
  method: "POST",
  body: JSON.stringify({
    code: "NEW_CATEGORY",
    name: "Nueva categoría",
    supportArea: "HARDWARE",
    defaultPriority: "MEDIUM",
    requiresSoftwareDetails: false,
  }),
});
```

Los usuarios comunes solo consultan categorías y catálogo. Las solicitudes de escritura para otras cuentas responden `403 FORBIDDEN`.

La documentación interactiva está disponible en `/api/docs` y el documento OpenAPI en `/api/openapi.json`.

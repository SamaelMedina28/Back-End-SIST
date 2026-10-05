const json = (schema: unknown, example?: unknown) => ({
    "application/json": {
        schema,
        ...(example === undefined ? {} : { example }),
    },
});

const successResponse = (description: string, dataSchema: unknown, example?: unknown) => ({
    description,
    content: json({
        allOf: [
            { $ref: "#/components/schemas/StandardSuccessResponse" },
            { type: "object", properties: { data: dataSchema } },
        ],
    }, example),
});

const errorResponse = (description: string) => ({
    description,
    content: json({ $ref: "#/components/schemas/StandardErrorResponse" }),
});

const errorResponses = (codes: number[]) => Object.fromEntries(
    codes.map((code) => [code, errorResponse(({
        401: "Sesión ausente o inválida.",
        403: "El usuario no tiene permiso para esta operación.",
        404: "El recurso solicitado no existe.",
        409: "Conflicto con el estado o unicidad del recurso.",
        422: "Los datos enviados no son válidos.",
    } as Record<number, string>)[code] ?? "Error de solicitud.")]),
);

const cookieSecurity = [{ cookieAuth: [] }];
const idParameter = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
};
const operation = (input: {
    summary: string;
    description: string;
    tags: string[];
    responses: Record<string, unknown>;
    security?: Array<Record<string, string[]>>;
    parameters?: unknown[];
    requestBody?: unknown;
    roles?: string[];
}) => ({
    summary: input.summary,
    description: input.description,
    tags: input.tags,
    ...(input.security ? { security: input.security } : {}),
    ...(input.parameters ? { parameters: input.parameters } : {}),
    ...(input.requestBody ? { requestBody: input.requestBody } : {}),
    ...(input.roles ? { "x-required-roles": input.roles } : {}),
    responses: input.responses,
});

export const openApiDocument = {
    openapi: "3.1.0",
    info: {
        title: "Sistema Integral de Soporte Técnico FCQI-UABC API",
        version: "1.0.0",
        description: "API REST de autenticación, catálogo y tickets de soporte técnico.",
    },
    servers: [{ url: "/" }],
    tags: [
        { name: "Auth" },
        { name: "Users" },
        { name: "Catalog" },
        { name: "Categories" },
        { name: "Subcategories" },
        { name: "Tickets" },
        { name: "Activity Log" },
        { name: "Inventory" },
        { name: "Support Members" },
        { name: "Dashboard" },
        { name: "Reports" },
        { name: "System" },
    ],
    paths: {
        "/api/v1/auth/google": {
            get: operation({
                summary: "Iniciar sesión con Google",
                description: "Inicia OAuth con state y PKCE. Redirige el navegador a Google.",
                tags: ["Auth"],
                responses: {
                    302: { description: "Redirección al consentimiento de Google." },
                    ...errorResponses([429]),
                },
            }),
        },
        "/api/v1/auth/google/callback": {
            get: operation({
                summary: "Callback OAuth de Google",
                description: "Valida state, canjea el código y redirige a éxito o onboarding.",
                tags: ["Auth"],
                parameters: [
                    { name: "code", in: "query", required: true, schema: { type: "string" } },
                    { name: "state", in: "query", required: true, schema: { type: "string" } },
                ],
                responses: {
                    302: { description: "Redirección al frontend después de autenticar." },
                    ...errorResponses([400, 401, 403, 409, 429]),
                },
            }),
        },
        "/api/v1/auth/complete-profile": {
            post: operation({
                summary: "Completar perfil de onboarding",
                description: "Crea un usuario USER a partir de la cookie HTTP-only de onboarding.",
                tags: ["Auth"],
                security: [{ onboardingCookie: [] }],
                requestBody: {
                    required: true,
                    content: json({ $ref: "#/components/schemas/CompleteProfileInput" }, {
                        institutionalId: "1287456", communityType: "STUDENT", phone: null,
                    }),
                },
                responses: {
                    201: successResponse("Usuario y sesión creados.", { $ref: "#/components/schemas/User" }),
                    ...errorResponses([401, 409, 422]),
                },
            }),
        },
        "/api/v1/auth/me": {
            get: operation({
                summary: "Consultar usuario autenticado",
                description: "Devuelve el perfil público asociado a la sesión actual.",
                tags: ["Auth"],
                security: cookieSecurity,
                responses: {
                    200: successResponse("Perfil actual.", { $ref: "#/components/schemas/User" }),
                    ...errorResponses([401]),
                },
            }),
        },
        "/api/v1/auth/logout": {
            post: operation({
                summary: "Cerrar sesión",
                description: "Elimina la cookie de sesión y cualquier cookie temporal OAuth.",
                tags: ["Auth"],
                security: cookieSecurity,
                responses: { 204: { description: "Sesión eliminada." }, ...errorResponses([401]) },
            }),
        },
        "/api/v1/users/me": {
            patch: operation({
                summary: "Actualizar perfil propio",
                description: "Permite editar únicamente fullName y phone.",
                tags: ["Users"],
                security: cookieSecurity,
                requestBody: {
                    required: true,
                    content: json({ $ref: "#/components/schemas/UpdateUserProfileInput" }, { fullName: "Nombre Apellido" }),
                },
                responses: {
                    200: successResponse("Perfil actualizado.", { $ref: "#/components/schemas/User" }),
                    ...errorResponses([401, 422]),
                },
            }),
        },
        "/api/v1/catalog/ticket-form": {
            get: operation({
                summary: "Cargar catálogo del formulario de ticket",
                description: "Devuelve categorías y subcategorías activas en orden alfabético, además del límite configurado.",
                tags: ["Catalog"],
                security: cookieSecurity,
                responses: {
                    200: successResponse("Datos del formulario.", { $ref: "#/components/schemas/TicketFormCatalog" }),
                    ...errorResponses([401]),
                },
            }),
        },
        "/api/v1/catalog/support-suggestions": {
            get: operation({
                summary: "Consultar sugerencias de soporte",
                description: "Devuelve sugerencias activas para una categoría y, cuando se indica, para la subcategoría seleccionada. Incluye sugerencias generales de la categoría.",
                tags: ["Catalog"],
                security: cookieSecurity,
                parameters: [
                    { name: "categoryId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
                    { name: "subcategoryId", in: "query", required: false, schema: { type: "string", format: "uuid" } },
                ],
                responses: {
                    200: successResponse("Lista de sugerencias, posiblemente vacía.", {
                        type: "array", items: { $ref: "#/components/schemas/SupportSuggestion" },
                    }),
                    ...errorResponses([401, 404, 422]),
                },
            }),
        },
        "/api/v1/categories": {
            get: operation({
                summary: "Listar categorías",
                description: "Los usuarios autenticados ven categorías activas. includeInactive=true está reservado a ADMIN. Las subcategorías inactivas se excluyen.",
                tags: ["Categories"],
                security: cookieSecurity,
                parameters: [{
                    name: "includeInactive", in: "query", required: false,
                    schema: { type: "boolean", default: false },
                }],
                responses: {
                    200: successResponse("Categorías ordenadas por nombre.", {
                        type: "array", items: { $ref: "#/components/schemas/Category" },
                    }),
                    ...errorResponses([401, 403, 422]),
                },
            }),
            post: operation({
                summary: "Crear categoría",
                description: "Solo ADMIN. El código técnico es UPPER_SNAKE_CASE y queda estable.",
                tags: ["Categories"],
                security: cookieSecurity,
                roles: ["ADMIN"],
                requestBody: {
                    required: true,
                    content: json({ $ref: "#/components/schemas/CreateCategoryInput" }, {
                        code: "PROJECTOR_FAILURE", name: "Falla de proyector", supportArea: "HARDWARE",
                        defaultPriority: null, requiresSoftwareDetails: false,
                    }),
                },
                responses: {
                    201: successResponse("Categoría creada.", { $ref: "#/components/schemas/Category" }),
                    ...errorResponses([401, 403, 409, 422]),
                },
            }),
        },
        "/api/v1/categories/{id}": {
            patch: operation({
                summary: "Actualizar categoría",
                description: "Solo ADMIN. code, id y timestamps no son editables.",
                tags: ["Categories"],
                security: cookieSecurity,
                roles: ["ADMIN"],
                parameters: [idParameter],
                requestBody: {
                    required: true,
                    content: json({ $ref: "#/components/schemas/UpdateCategoryInput" }, { name: "Falla de proyectores" }),
                },
                responses: {
                    200: successResponse("Categoría actualizada.", { $ref: "#/components/schemas/Category" }),
                    ...errorResponses([401, 403, 404, 422]),
                },
            }),
            delete: operation({
                summary: "Desactivar categoría",
                description: "Solo ADMIN. Soft delete idempotente; no desactiva subcategorías ni elimina datos históricos.",
                tags: ["Categories"],
                security: cookieSecurity,
                roles: ["ADMIN"],
                parameters: [idParameter],
                responses: { 204: { description: "Categoría desactivada." }, ...errorResponses([401, 403, 404, 422]) },
            }),
        },
        "/api/v1/categories/{categoryId}/subcategories": {
            post: operation({
                summary: "Crear subcategoría",
                description: "Solo ADMIN. Requiere categoría existente y activa. La unicidad del código es por categoría.",
                tags: ["Subcategories"],
                security: cookieSecurity,
                roles: ["ADMIN"],
                parameters: [{
                    name: "categoryId", in: "path", required: true,
                    schema: { type: "string", format: "uuid" },
                }],
                requestBody: {
                    required: true,
                    content: json({ $ref: "#/components/schemas/CreateSubcategoryInput" }, {
                        code: "CONNECTION_FAILURE", name: "Falla de conexión", priority: "HIGH",
                    }),
                },
                responses: {
                    201: successResponse("Subcategoría creada.", { $ref: "#/components/schemas/Subcategory" }),
                    ...errorResponses([401, 403, 404, 409, 422]),
                },
            }),
        },
        "/api/v1/subcategories/{id}": {
            patch: operation({
                summary: "Actualizar subcategoría",
                description: "Solo ADMIN. code, categoryId, id y timestamps no son editables.",
                tags: ["Subcategories"],
                security: cookieSecurity,
                roles: ["ADMIN"],
                parameters: [idParameter],
                requestBody: {
                    required: true,
                    content: json({ $ref: "#/components/schemas/UpdateSubcategoryInput" }, { priority: null }),
                },
                responses: {
                    200: successResponse("Subcategoría actualizada.", { $ref: "#/components/schemas/Subcategory" }),
                    ...errorResponses([401, 403, 404, 422]),
                },
            }),
            delete: operation({
                summary: "Desactivar subcategoría",
                description: "Solo ADMIN. Soft delete idempotente.",
                tags: ["Subcategories"],
                security: cookieSecurity,
                roles: ["ADMIN"],
                parameters: [idParameter],
                responses: { 204: { description: "Subcategoría desactivada." }, ...errorResponses([401, 403, 404, 422]) },
            }),
        },
        "/api/v1/tickets": {
            post: operation({
                summary: "Crear ticket",
                description: "Crea un ticket OPEN y su evento CREATED de forma atómica. La prioridad proviene de la subcategoría o categoría; el servidor guarda snapshots, limita a 10 tickets activos por USER y protege duplicados con UNIQUE. Las solicitudes de software requieren TEACHER.",
                tags: ["Tickets"], security: cookieSecurity,
                roles: ["USER"],
                requestBody: { required: true, content: json({ $ref: "#/components/schemas/CreateTicketRequest" }, {
                    title: "Proyector sin señal", categoryId: "00000000-0000-4000-8000-000000000001",
                    subcategoryId: "00000000-0000-4000-8000-000000000002", building: "Edificio 6", room: "603",
                    description: "El proyector enciende pero no muestra señal.", contactPhone: null, inventoryItemId: null,
                }) },
                responses: {
                    201: successResponse("Ticket creado.", { $ref: "#/components/schemas/CreatedTicket" }),
                    ...errorResponses([401, 403, 404, 409, 422, 500]),
                },
            }),
            get: operation({
                summary: "Listar tickets visibles",
                description: "USER ve sus reportes; SUPPORT y SUB_MANAGER ven tickets de sus áreas; ADMIN ve todos. Los filtros reducen ese conjunto. assignment acepta mine, unassigned o assigned; USER no usa assignment, assignedTo ni supportArea. createdFrom y createdTo son instantes ISO inclusivos.",
                tags: ["Tickets"], security: cookieSecurity,
                parameters: [
                    { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
                    { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
                    { name: "search", in: "query", schema: { type: "string", maxLength: 100 }, description: "Código o título, sin distinguir mayúsculas." },
                    { name: "status", in: "query", schema: { type: "string", enum: ["OPEN", "IN_REVIEW", "IN_PROGRESS", "COMPLETED", "CANCELLED"] } },
                    { name: "priority", in: "query", schema: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] } },
                    { name: "categoryId", in: "query", schema: { type: "string", format: "uuid" } },
                    { name: "subcategoryId", in: "query", schema: { type: "string", format: "uuid" } },
                    { name: "assignment", in: "query", schema: { type: "string", enum: ["mine", "unassigned", "assigned"] } },
                    { name: "assignedTo", in: "query", schema: { type: "string", format: "uuid" } },
                    { name: "supportArea", in: "query", schema: { type: "string", enum: ["HARDWARE", "SOFTWARE", "NETWORKS", "ADMINISTRATIVE"] } },
                    { name: "createdFrom", in: "query", schema: { type: "string", format: "date-time" } },
                    { name: "createdTo", in: "query", schema: { type: "string", format: "date-time" } },
                    { name: "sort", in: "query", schema: { type: "string", enum: ["createdAt", "updatedAt", "priority", "status", "code"], default: "createdAt" } },
                    { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
                ],
                responses: {
                    200: { description: "Página de tickets visibles.", content: json({ $ref: "#/components/schemas/PaginatedTicketsResponse" }) },
                    ...errorResponses([401, 403, 422]),
                },
            }),
        },
        "/api/v1/tickets/{id}": {
            get: operation({
                summary: "Consultar detalle de ticket",
                description: "Devuelve el detalle visible para el actor; el reportero se representa mediante snapshots históricos.",
                tags: ["Tickets"], security: cookieSecurity, parameters: [idParameter],
                responses: {
                    200: successResponse("Detalle del ticket.", { $ref: "#/components/schemas/TicketDetail" }),
                    ...errorResponses([401, 403, 404, 422]),
                },
            }),
        },
        "/api/v1/tickets/{id}/assign-self": {
            post: operation({
                summary: "Autoasignar ticket",
                description: "SUPPORT o SUB_MANAGER se asigna un ticket activo de una de sus áreas. La operación serializa concurrencia y emite ASSIGNED una sola vez.",
                tags: ["Tickets"], security: cookieSecurity, roles: ["SUPPORT", "SUB_MANAGER"],
                parameters: [idParameter], requestBody: { required: false, content: json({ $ref: "#/components/schemas/EmptyObject" }) },
                responses: { 200: successResponse("Ticket asignado.", { $ref: "#/components/schemas/TicketAssignmentResult" }), ...errorResponses([401, 403, 404, 409, 422]) },
            }),
        },
        "/api/v1/tickets/{id}/assignee": {
            put: operation({
                summary: "Asignar o reasignar ticket",
                description: "ADMIN asigna un ticket activo a una cuenta SUPPORT/SUB_MANAGER activa cuya área incluya la categoría. Repetir el mismo asignado no duplica el evento.",
                tags: ["Tickets"], security: cookieSecurity, roles: ["ADMIN"], parameters: [idParameter],
                requestBody: { required: true, content: json({ $ref: "#/components/schemas/AdminAssigneeInput" }) },
                responses: { 200: successResponse("Ticket asignado.", { $ref: "#/components/schemas/TicketAssignmentResult" }), ...errorResponses([401, 403, 404, 409, 422]) },
            }),
            delete: operation({
                summary: "Retirar asignación",
                description: "ADMIN retira la asignación de un ticket activo. Si ya está sin asignar, responde 204 sin emitir evento.",
                tags: ["Tickets"], security: cookieSecurity, roles: ["ADMIN"], parameters: [idParameter],
                responses: { 204: { description: "Asignación retirada o ya inexistente." }, ...errorResponses([401, 403, 404, 409, 422]) },
            }),
        },
        "/api/v1/tickets/{id}/status": {
            patch: operation({
                summary: "Cambiar estado de ticket",
                description: "ADMIN puede cambiar cualquier ticket; SUPPORT/SUB_MANAGER solo uno asignado a sí mismo y dentro de sus áreas. Una clave Idempotency-Key persiste la respuesta durante 24 horas.",
                tags: ["Tickets"], security: cookieSecurity, roles: ["ADMIN", "SUPPORT", "SUB_MANAGER"],
                parameters: [idParameter, { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", minLength: 1, maxLength: 200 } }],
                requestBody: { required: true, content: json({ $ref: "#/components/schemas/TicketStatusInput" }) },
                responses: { 200: successResponse("Estado actualizado o respuesta idempotente reproducida.", { $ref: "#/components/schemas/TicketStatusResult" }), ...errorResponses([401, 403, 404, 409, 422]) },
            }),
        },
        "/api/v1/tickets/{id}/priority": {
            patch: operation({
                summary: "Cambiar prioridad de ticket",
                description: "Solo ADMIN. Requiere una razón no vacía; los tickets terminales no se modifican y repetir la prioridad actual no emite evento.",
                tags: ["Tickets"], security: cookieSecurity, roles: ["ADMIN"], parameters: [idParameter],
                requestBody: { required: true, content: json({ $ref: "#/components/schemas/TicketPriorityInput" }) },
                responses: { 200: successResponse("Prioridad actualizada.", { $ref: "#/components/schemas/TicketPriorityResult" }), ...errorResponses([401, 403, 404, 409, 422]) },
            }),
        },
        "/api/v1/tickets/{id}/events": {
            get: operation({
                summary: "Consultar eventos de ticket",
                description: "Aplica la misma autorización del detalle. Ordena por createdAt ASC y por id ASC en caso de empate.",
                tags: ["Tickets"], security: cookieSecurity, parameters: [idParameter],
                responses: {
                    200: successResponse("Timeline del ticket.", { type: "array", items: { $ref: "#/components/schemas/TicketEvent" } }),
                    ...errorResponses([401, 403, 404, 422]),
                },
            }),
        },
        "/api/v1/activity-log": {
            get: operation({
                summary: "Listar bitácora de servicio",
                description: "SUPPORT, SUB_MANAGER y ADMIN. SUPPORT/SUB_MANAGER solo consulta actividades de sus áreas. Los filtros reducen ese ámbito. from/to filtran serviceStartedAt; fecha sin hora abarca el día UTC completo.",
                tags: ["Activity Log"], security: cookieSecurity, roles: ["SUPPORT", "SUB_MANAGER", "ADMIN"],
                parameters: [
                    { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
                    { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
                    { name: "ticketId", in: "query", schema: { type: "string", format: "uuid" } },
                    { name: "technicianId", in: "query", schema: { type: "string", format: "uuid" }, description: "Busca en ActivityParticipant.userId, no createdById." },
                    { name: "status", in: "query", schema: { type: "string", enum: ["IN_PROGRESS", "COMPLETED"] } },
                    { name: "search", in: "query", schema: { type: "string" }, description: "Busca sin distinguir mayúsculas en código/título/falla/reportero snapshot y actividad." },
                    { name: "from", in: "query", schema: { oneOf: [{ type: "string", format: "date-time" }, { type: "string", format: "date" }] }, description: "Inicio inclusivo aplicado a serviceStartedAt; acepta YYYY-MM-DD UTC." },
                    { name: "to", in: "query", schema: { oneOf: [{ type: "string", format: "date-time" }, { type: "string", format: "date" }] }, description: "Fin inclusivo aplicado a serviceStartedAt; fecha YYYY-MM-DD incluye el día UTC completo." },
                ],
                responses: {
                    200: { description: "Página visible de bitácoras.", content: json({ $ref: "#/components/schemas/PaginatedActivityLogsResponse" }) },
                    ...errorResponses([401, 403, 422]),
                },
            }),
            post: operation({
                summary: "Registrar actividad de servicio",
                description: "SUB_MANAGER crea dentro de sus áreas; ADMIN puede crear sobre tickets de cualquier área. Snapshots del ticket y del reportero se capturan en la misma transacción que la bitácora y participantes.",
                tags: ["Activity Log"], security: cookieSecurity, roles: ["SUB_MANAGER", "ADMIN"],
                requestBody: { required: true, content: json({ $ref: "#/components/schemas/ActivityLogCreateRequest" }) },
                responses: { 201: successResponse("Actividad creada.", { $ref: "#/components/schemas/ActivityLogDetail" }), ...errorResponses([401, 403, 404, 409, 422]) },
            }),
        },
        "/api/v1/activity-log/{id}": {
            get: operation({
                summary: "Consultar detalle de bitácora",
                description: "SUPPORT, SUB_MANAGER y ADMIN. El soporte solo ve entradas cuyo ticket pertenezca a una de sus áreas.",
                tags: ["Activity Log"], security: cookieSecurity, roles: ["SUPPORT", "SUB_MANAGER", "ADMIN"], parameters: [idParameter],
                responses: { 200: successResponse("Detalle de bitácora.", { $ref: "#/components/schemas/ActivityLogDetail" }), ...errorResponses([401, 403, 404, 422]) },
            }),
            patch: operation({
                summary: "Modificar actividad de servicio",
                description: "SUB_MANAGER solo dentro de sus áreas; ADMIN en cualquier área. Cada cambio real y su ActivityLogRevision se escriben en una transacción con bloqueo FOR UPDATE. No hay DELETE.",
                tags: ["Activity Log"], security: cookieSecurity, roles: ["SUB_MANAGER", "ADMIN"], parameters: [idParameter],
                requestBody: { required: true, content: json({ $ref: "#/components/schemas/ActivityLogPatchRequest" }) },
                responses: { 200: successResponse("Actividad actualizada o sin cambios.", { $ref: "#/components/schemas/ActivityLogDetail" }), ...errorResponses([401, 403, 404, 409, 422]) },
            }),
        },
        "/api/v1/activity-log/{id}/history": {
            get: operation({
                summary: "Consultar auditoría de bitácora",
                description: "Solo SUB_MANAGER y ADMIN, con la misma visibilidad por área. Revisiones append-only ordenadas por createdAt ascendente.",
                tags: ["Activity Log"], security: cookieSecurity, roles: ["SUB_MANAGER", "ADMIN"], parameters: [idParameter],
                responses: { 200: successResponse("Historial inmutable de cambios.", { type: "array", items: { $ref: "#/components/schemas/ActivityLogRevision" } }), ...errorResponses([401, 403, 404, 422]) },
            }),
        },
        "/api/v1/inventory": {
            get: operation({
                summary: "Listar inventario",
                description: "SUB_MANAGER y ADMIN. Por defecto solo activos; búsqueda case-insensitive en modelo, código patrimonial, serie y ubicación. Orden createdAt DESC, id ASC.",
                tags: ["Inventory"], security: cookieSecurity, roles: ["SUB_MANAGER", "ADMIN"],
                parameters: [
                    { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
                    { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
                    { name: "search", in: "query", schema: { type: "string", minLength: 1 } },
                    { name: "type", in: "query", schema: { type: "string", enum: ["COMPUTER", "PROJECTOR", "CONTROL", "ADAPTER"] } },
                    { name: "building", in: "query", schema: { type: "string", minLength: 1 } },
                    { name: "active", in: "query", schema: { type: "string", enum: ["true", "false"], default: "true" } },
                ],
                responses: { 200: { description: "Página de artículos.", content: json({ $ref: "#/components/schemas/PaginatedInventoryResponse" }) }, ...errorResponses([401, 403, 422]) },
            }),
            post: operation({
                summary: "Crear artículo de inventario",
                description: "SUB_MANAGER y ADMIN. El body es estricto y la validación depende de InventoryType; no acepta id, isActive ni timestamps.",
                tags: ["Inventory"], security: cookieSecurity, roles: ["SUB_MANAGER", "ADMIN"],
                requestBody: { required: true, content: json({ $ref: "#/components/schemas/CreateInventoryRequest" }, {
                    type: "COMPUTER", model: "Dell OptiPlex 7090", assetCode: "PAT-00421", color: "Negro", size: "SFF",
                    building: "Edificio 6", room: "603", serialNumber: "DX92K1", quantity: 1, notes: null,
                }) },
                responses: { 201: successResponse("Artículo creado.", { $ref: "#/components/schemas/InventoryItem" }), ...errorResponses([401, 403, 409, 422]) },
            }),
        },
        "/api/v1/inventory/{id}": {
            get: operation({
                summary: "Consultar artículo de inventario",
                description: "Devuelve el detalle incluso si el artículo está inactivo.",
                tags: ["Inventory"], security: cookieSecurity, roles: ["SUB_MANAGER", "ADMIN"], parameters: [idParameter],
                responses: { 200: successResponse("Detalle del artículo.", { $ref: "#/components/schemas/InventoryItem" }), ...errorResponses([401, 403, 404, 422]) },
            }),
            patch: operation({
                summary: "Actualizar artículo de inventario",
                description: "PATCH parcial; type es inmutable, isActive no es editable. Se valida el registro final bajo bloqueo de fila; un PATCH sin cambios devuelve 200 sin escribir.",
                tags: ["Inventory"], security: cookieSecurity, roles: ["SUB_MANAGER", "ADMIN"], parameters: [idParameter],
                requestBody: { required: true, content: json({ $ref: "#/components/schemas/PatchInventoryRequest" }, { room: "604", notes: "Reubicado" }) },
                responses: { 200: successResponse("Artículo actualizado.", { $ref: "#/components/schemas/InventoryItem" }), ...errorResponses([401, 403, 404, 409, 422]) },
            }),
            delete: operation({
                summary: "Desactivar artículo de inventario",
                description: "Soft delete idempotente. Conserva el artículo, sus identificadores únicos y tickets asociados.",
                tags: ["Inventory"], security: cookieSecurity, roles: ["SUB_MANAGER", "ADMIN"], parameters: [idParameter],
                responses: { 204: { description: "Artículo desactivado o ya inactivo." }, ...errorResponses([401, 403, 404, 422]) },
            }),
        },
        "/api/v1/inventory/{id}/tickets": {
            get: operation({
                summary: "Consultar historial de tickets de inventario",
                description: "Funciona también para un artículo inactivo. reporter.fullName usa Ticket.reporterNameSnapshot. Orden createdAt DESC, id ASC; from/to filtran la fecha de creación del ticket.",
                tags: ["Inventory"], security: cookieSecurity, roles: ["SUB_MANAGER", "ADMIN"],
                parameters: [idParameter,
                    { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
                    { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
                    { name: "status", in: "query", schema: { type: "string", enum: ["OPEN", "IN_REVIEW", "IN_PROGRESS", "COMPLETED", "CANCELLED"] } },
                    { name: "from", in: "query", schema: { oneOf: [{ type: "string", format: "date-time" }, { type: "string", format: "date" }] } },
                    { name: "to", in: "query", schema: { oneOf: [{ type: "string", format: "date-time" }, { type: "string", format: "date" }] } },
                ],
                responses: { 200: { description: "Página del historial de tickets.", content: json({ $ref: "#/components/schemas/PaginatedInventoryTicketHistoryResponse" }) }, ...errorResponses([401, 403, 404, 422]) },
            }),
        },
        "/api/v1/support-members": {
            get: operation({
                summary: "Listar miembros de soporte",
                description: "Solo ADMIN. Miembros SUPPORT/SUB_MANAGER; activos por defecto. Orden fullName ASC, id ASC. Útil para el selector de asignación por supportArea.",
                tags: ["Support Members"], security: cookieSecurity, roles: ["ADMIN"],
                parameters: [
                    { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
                    { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
                    { name: "search", in: "query", schema: { type: "string", minLength: 1 } },
                    { name: "role", in: "query", schema: { type: "string", enum: ["SUPPORT", "SUB_MANAGER"] } },
                    { name: "supportArea", in: "query", schema: { type: "string", enum: ["HARDWARE", "SOFTWARE", "NETWORKS", "ADMINISTRATIVE"] } },
                    { name: "active", in: "query", schema: { type: "string", enum: ["true", "false"], default: "true" } },
                ],
                responses: { 200: { description: "Página de miembros de soporte.", content: json({ $ref: "#/components/schemas/PaginatedSupportMembersResponse" }) }, ...errorResponses([401, 403, 422]) },
            }),
            post: operation({
                summary: "Pre-provisionar miembro de soporte",
                description: "Solo ADMIN. googleSubject queda null hasta el primer acceso Google OAuth; no se envía invitación. Email e institutionalId son únicos.",
                tags: ["Support Members"], security: cookieSecurity, roles: ["ADMIN"],
                requestBody: { required: true, content: json({ $ref: "#/components/schemas/CreateSupportMemberRequest" }) },
                responses: { 201: successResponse("Miembro creado.", { $ref: "#/components/schemas/SupportMember" }), ...errorResponses([401, 403, 409, 422]) },
            }),
        },
        "/api/v1/support-members/{id}": {
            get: operation({
                summary: "Consultar miembro de soporte",
                description: "Solo ADMIN. Incluye miembros inactivos; USER y ADMIN se tratan como no encontrados.",
                tags: ["Support Members"], security: cookieSecurity, roles: ["ADMIN"], parameters: [idParameter],
                responses: { 200: successResponse("Detalle del miembro.", { $ref: "#/components/schemas/SupportMember" }), ...errorResponses([401, 403, 404, 422]) },
            }),
            patch: operation({
                summary: "Modificar miembro de soporte",
                description: "Solo ADMIN. PATCH parcial estricto; conserva identidad y vínculo Google. La desactivación falla con SUPPORT_MEMBER_HAS_ACTIVE_TICKETS si tiene tickets activos asignados.",
                tags: ["Support Members"], security: cookieSecurity, roles: ["ADMIN"], parameters: [idParameter],
                requestBody: { required: true, content: json({ $ref: "#/components/schemas/PatchSupportMemberRequest" }) },
                responses: { 200: successResponse("Miembro actualizado.", { $ref: "#/components/schemas/SupportMember" }), ...errorResponses([401, 403, 404, 409, 422]) },
            }),
            delete: operation({
                summary: "Desactivar miembro de soporte",
                description: "Solo ADMIN. Baja lógica idempotente; conserva tickets, bitácoras e identidad Google. Bloquea si hay tickets OPEN, IN_REVIEW o IN_PROGRESS asignados.",
                tags: ["Support Members"], security: cookieSecurity, roles: ["ADMIN"], parameters: [idParameter],
                responses: { 204: { description: "Miembro desactivado o ya inactivo." }, ...errorResponses([401, 403, 404, 409, 422]) },
            }),
        },
        "/api/v1/dashboard": {
            get: operation({
                summary: "Consultar dashboard según rol",
                description: "Requiere sesión. USER recibe métricas y tickets propios; SUPPORT/SUB_MANAGER solo sus áreas; ADMIN métricas globales y carga de técnicos. completedToday usa APP_TIMEZONE. No acepta role en query.",
                tags: ["Dashboard"], security: cookieSecurity, roles: ["USER", "SUPPORT", "SUB_MANAGER", "ADMIN"],
                responses: {
                    200: { description: "Dashboard correspondiente al rol actual de la sesión.", content: json({ oneOf: [
                        { $ref: "#/components/schemas/UserDashboardResponse" },
                        { $ref: "#/components/schemas/SupportDashboardResponse" },
                        { $ref: "#/components/schemas/AdminDashboardResponse" },
                    ] }) },
                    ...errorResponses([401, 500]),
                },
            }),
        },
        "/api/v1/reports/activity": {
            get: operation({
                summary: "Consultar actividad operativa por periodo",
                description: "Solo ADMIN. Fechas locales inclusivas en APP_TIMEZONE, convertidas a un intervalo UTC semiabierto. Las creaciones se cuentan por createdAt, las resoluciones por completedAt de tickets COMPLETED y pending es el estado actual de tickets creados en el rango. Los filtros se aplican a todos los agregados; technicianId corresponde al assigneeId actual/final.",
                tags: ["Reports"], security: cookieSecurity, roles: ["ADMIN"],
                parameters: [
                    { name: "from", in: "query", required: true, schema: { type: "string", format: "date" }, description: "Primer día local (YYYY-MM-DD)." },
                    { name: "to", in: "query", required: true, schema: { type: "string", format: "date" }, description: "Último día local inclusivo (YYYY-MM-DD); to >= from." },
                    { name: "supportArea", in: "query", schema: { type: "string", enum: ["HARDWARE", "SOFTWARE", "NETWORKS", "ADMINISTRATIVE"] }, description: "Área de la categoría del ticket." },
                    { name: "categoryId", in: "query", schema: { type: "string", format: "uuid" } },
                    { name: "technicianId", in: "query", schema: { type: "string", format: "uuid" }, description: "Filtra por assigneeId del ticket." },
                ],
                responses: {
                    200: { description: "Agregados de actividad. Incluye días sin actividad con ceros.", content: json(
                        { $ref: "#/components/schemas/ActivityReportResponse" },
                        { success: true, data: { summary: { ticketsCreated: 2, ticketsCompleted: 1, pending: 1, averageResolutionMinutes: 90 },
                            byCategory: [{ categoryId: "fc409380-51b1-4f58-a0c8-304acb28204e", category: "Proyectores", count: 2 }],
                            byTechnician: [{ technicianId: "7ce569e1-02e1-46bf-a9f7-a4567419f764", name: "Ana López", completed: 1, active: 1 }],
                            daily: [{ date: "2026-09-01", created: 2, completed: 0 }, { date: "2026-09-02", created: 0, completed: 1 }] } },
                    ) },
                    ...errorResponses([401, 403, 422, 500]),
                },
            }),
        },
        "/health": {
            get: operation({
                summary: "Estado del proceso",
                description: "Comprueba que el servidor Express responda.",
                tags: ["System"],
                responses: {
                    200: {
                        description: "Proceso activo.",
                        content: json({ type: "object", properties: { status: { const: "ok" } } }, { status: "ok" }),
                    },
                },
            }),
        },
        "/ready": {
            get: operation({
                summary: "Readiness del servicio",
                description: "Comprueba que PostgreSQL responda.",
                tags: ["System"],
                responses: {
                    200: {
                        description: "Base de datos disponible.",
                        content: json({ type: "object", properties: {
                            status: { const: "ready" }, database: { const: "connected" },
                        } }, { status: "ready", database: "connected" }),
                    },
                    503: {
                        description: "Base de datos no disponible.",
                        content: json({ type: "object", properties: {
                            status: { const: "not_ready" }, database: { const: "disconnected" },
                        } }, { status: "not_ready", database: "disconnected" }),
                    },
                },
            }),
        },
    },
    components: {
        securitySchemes: {
            cookieAuth: { type: "apiKey", in: "cookie", name: "sist_session", description: "Cookie de sesión configurada mediante SESSION_COOKIE_NAME." },
            onboardingCookie: { type: "apiKey", in: "cookie", name: "sist_onboarding", description: "Cookie temporal de onboarding emitida por Google OAuth." },
        },
        schemas: {
            ActivityReportSummary: { type: "object", additionalProperties: false,
                required: ["ticketsCreated", "ticketsCompleted", "pending", "averageResolutionMinutes"], properties: {
                    ticketsCreated: { type: "integer", minimum: 0 }, ticketsCompleted: { type: "integer", minimum: 0 },
                    pending: { type: "integer", minimum: 0 }, averageResolutionMinutes: { type: "integer", minimum: 0 },
                } },
            ActivityReportCategory: { type: "object", additionalProperties: false, required: ["categoryId", "category", "count"], properties: {
                categoryId: { type: "string", format: "uuid" }, category: { type: "string" }, count: { type: "integer", minimum: 1 },
            } },
            ActivityReportTechnician: { type: "object", additionalProperties: false,
                required: ["technicianId", "name", "completed", "active"], properties: {
                    technicianId: { type: "string", format: "uuid" }, name: { type: "string" },
                    completed: { type: "integer", minimum: 0 }, active: { type: "integer", minimum: 0 },
                } },
            ActivityReportDaily: { type: "object", additionalProperties: false, required: ["date", "created", "completed"], properties: {
                date: { type: "string", format: "date" }, created: { type: "integer", minimum: 0 }, completed: { type: "integer", minimum: 0 },
            } },
            ActivityReportResponse: { type: "object", additionalProperties: false, required: ["success", "data"], properties: {
                success: { const: true }, data: { type: "object", additionalProperties: false,
                    required: ["summary", "byCategory", "byTechnician", "daily"], properties: {
                        summary: { $ref: "#/components/schemas/ActivityReportSummary" },
                        byCategory: { type: "array", items: { $ref: "#/components/schemas/ActivityReportCategory" } },
                        byTechnician: { type: "array", items: { $ref: "#/components/schemas/ActivityReportTechnician" } },
                        daily: { type: "array", items: { $ref: "#/components/schemas/ActivityReportDaily" } },
                    } },
            } },
            DashboardUserStats: { type: "object", additionalProperties: false, required: ["active", "inProgress", "completed"], properties: {
                active: { type: "integer", minimum: 0 }, inProgress: { type: "integer", minimum: 0 }, completed: { type: "integer", minimum: 0 },
            } },
            DashboardSupportStats: { type: "object", additionalProperties: false, required: ["unassigned", "mine", "highPriority", "completedToday"], properties: {
                unassigned: { type: "integer", minimum: 0 }, mine: { type: "integer", minimum: 0 }, highPriority: { type: "integer", minimum: 0 }, completedToday: { type: "integer", minimum: 0 },
            } },
            DashboardAdminStats: { type: "object", additionalProperties: false, required: ["activeTickets", "unassigned", "activeTechnicians", "inventoryItems"], properties: {
                activeTickets: { type: "integer", minimum: 0 }, unassigned: { type: "integer", minimum: 0 },
                activeTechnicians: { type: "integer", minimum: 0 }, inventoryItems: { type: "integer", minimum: 0 },
            } },
            TechnicianWorkloadItem: { type: "object", additionalProperties: false,
                required: ["userId", "name", "supportAreas", "activeTickets", "completedToday"], properties: {
                    userId: { type: "string", format: "uuid" }, name: { type: "string" },
                    supportAreas: { type: "array", items: { type: "string", enum: ["HARDWARE", "SOFTWARE", "NETWORKS", "ADMINISTRATIVE"] } },
                    activeTickets: { type: "integer", minimum: 0 }, completedToday: { type: "integer", minimum: 0 },
                },
            },
            UserDashboardResponse: { type: "object", additionalProperties: false, required: ["success", "data"], properties: {
                success: { const: true }, data: { type: "object", additionalProperties: false, required: ["stats", "recentTickets"], properties: {
                    stats: { $ref: "#/components/schemas/DashboardUserStats" },
                    recentTickets: { type: "array", maxItems: 5, items: { $ref: "#/components/schemas/TicketListItem" } },
                } },
            } },
            SupportDashboardResponse: { type: "object", additionalProperties: false, required: ["success", "data"], properties: {
                success: { const: true }, data: { type: "object", additionalProperties: false, required: ["stats", "priorityTickets"], properties: {
                    stats: { $ref: "#/components/schemas/DashboardSupportStats" },
                    priorityTickets: { type: "array", maxItems: 10, items: { $ref: "#/components/schemas/TicketListItem" } },
                } },
            } },
            AdminDashboardResponse: { type: "object", additionalProperties: false, required: ["success", "data"], properties: {
                success: { const: true }, data: { type: "object", additionalProperties: false, required: ["stats", "technicianWorkload"], properties: {
                    stats: { $ref: "#/components/schemas/DashboardAdminStats" },
                    technicianWorkload: { type: "array", items: { $ref: "#/components/schemas/TechnicianWorkloadItem" } },
                } },
            } },
            SupportMemberListItem: { type: "object", required: ["id", "fullName", "email", "institutionalId", "communityType", "role", "supportAreas", "skills", "isActive", "googleLinked", "lastLoginAt"], properties: {
                id: { type: "string", format: "uuid" }, fullName: { type: "string" }, email: { type: "string", format: "email" },
                institutionalId: { type: "string" }, communityType: { type: "string", enum: ["STUDENT", "TEACHER", "ADMINISTRATIVE"] },
                role: { type: "string", enum: ["SUPPORT", "SUB_MANAGER"] },
                supportAreas: { type: "array", minItems: 0, uniqueItems: true, items: { type: "string", enum: ["HARDWARE", "SOFTWARE", "NETWORKS", "ADMINISTRATIVE"] } },
                skills: { type: "array", items: { type: "string" } }, isActive: { type: "boolean" }, googleLinked: { type: "boolean" },
                lastLoginAt: { type: ["string", "null"], format: "date-time" },
            } },
            SupportMember: { allOf: [
                { $ref: "#/components/schemas/SupportMemberListItem" },
                { type: "object", required: ["createdAt", "updatedAt"], properties: {
                    createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
                } },
            ] },
            CreateSupportMemberRequest: { type: "object", additionalProperties: false,
                required: ["fullName", "email", "institutionalId", "communityType", "role", "supportAreas", "skills"], properties: {
                    fullName: { type: "string", minLength: 1, maxLength: 150 }, email: { type: "string", format: "email" },
                    institutionalId: { type: "string", minLength: 1, maxLength: 100 },
                    communityType: { type: "string", enum: ["STUDENT", "TEACHER", "ADMINISTRATIVE"] },
                    role: { type: "string", enum: ["SUPPORT", "SUB_MANAGER"] },
                    supportAreas: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", enum: ["HARDWARE", "SOFTWARE", "NETWORKS", "ADMINISTRATIVE"] } },
                    skills: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 100 } },
                },
            },
            PatchSupportMemberRequest: { type: "object", additionalProperties: false, properties: {
                fullName: { type: "string", minLength: 1, maxLength: 150 }, role: { type: "string", enum: ["SUPPORT", "SUB_MANAGER"] },
                supportAreas: { type: "array", uniqueItems: true, items: { type: "string", enum: ["HARDWARE", "SOFTWARE", "NETWORKS", "ADMINISTRATIVE"] } },
                skills: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 100 } },
                isActive: { type: "boolean" },
            } },
            PaginatedSupportMembersResponse: { type: "object", required: ["success", "data", "meta"], properties: {
                success: { const: true }, data: { type: "array", items: { $ref: "#/components/schemas/SupportMemberListItem" } },
                meta: { type: "object", required: ["page", "pageSize", "total", "totalPages"], properties: {
                    page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" },
                } },
            } },
            EmptyObject: { type: "object", maxProperties: 0, additionalProperties: false },
            AdminAssigneeInput: { type: "object", required: ["assigneeId"], additionalProperties: false, properties: { assigneeId: { type: "string", format: "uuid" } } },
            TicketStatusInput: { type: "object", required: ["status"], additionalProperties: false, properties: {
                status: { type: "string", enum: ["OPEN", "IN_REVIEW", "IN_PROGRESS", "COMPLETED", "CANCELLED"] },
                note: { type: "string", minLength: 1, maxLength: 500, description: "Obligatoria al cancelar." },
            } },
            TicketPriorityInput: { type: "object", required: ["priority", "reason"], additionalProperties: false, properties: {
                priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] }, reason: { type: "string", minLength: 1, maxLength: 500 },
            } },
            TicketAssignmentResult: { type: "object", required: ["id", "code", "assignee", "assignedAt"], properties: {
                id: { type: "string", format: "uuid" }, code: { type: "string" }, assignee: { anyOf: [{ type: "object", properties: { id: { type: "string", format: "uuid" }, fullName: { type: "string" } } }, { type: "null" }] }, assignedAt: { type: ["string", "null"], format: "date-time" },
            } },
            TicketStatusResult: { type: "object", required: ["id", "code", "status", "updatedAt"], properties: {
                id: { type: "string", format: "uuid" }, code: { type: "string" }, status: { type: "string", enum: ["OPEN", "IN_REVIEW", "IN_PROGRESS", "COMPLETED", "CANCELLED"] }, updatedAt: { type: "string", format: "date-time" },
            } },
            TicketPriorityResult: { type: "object", required: ["id", "code", "priority", "updatedAt"], properties: {
                id: { type: "string", format: "uuid" }, code: { type: "string" }, priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] }, updatedAt: { type: "string", format: "date-time" },
            } },
            ActivityLogCreateRequest: { type: "object", additionalProperties: false,
                required: ["ticketId", "activity", "participantIds", "serviceStartedAt", "timeSpentMinutes", "status"], properties: {
                    ticketId: { type: "string", format: "uuid" }, activity: { type: "string", minLength: 1 },
                    participantIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", format: "uuid" } },
                    serviceStartedAt: { type: "string", format: "date-time" }, serviceEndedAt: { type: ["string", "null"], format: "date-time" },
                    timeSpentMinutes: { type: "integer", minimum: 1 }, status: { type: "string", enum: ["IN_PROGRESS", "COMPLETED"] },
                },
            },
            ActivityLogPatchRequest: { type: "object", additionalProperties: false, properties: {
                activity: { type: "string", minLength: 1 },
                participantIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", format: "uuid" } },
                serviceStartedAt: { type: "string", format: "date-time" }, serviceEndedAt: { type: ["string", "null"], format: "date-time" },
                timeSpentMinutes: { type: "integer", minimum: 1 }, status: { type: "string", enum: ["IN_PROGRESS", "COMPLETED"] },
            } },
            ActivityLogListItem: { type: "object", required: ["id", "ticket", "failure", "activity", "participants", "serviceStartedAt", "serviceEndedAt", "timeSpentMinutes", "status", "createdAt"], properties: {
                id: { type: "string", format: "uuid" }, ticket: { $ref: "#/components/schemas/ActivityLogTicket" }, failure: { type: "string" }, activity: { type: "string" },
                participants: { type: "array", items: { $ref: "#/components/schemas/ActivityLogParticipant" } }, serviceStartedAt: { type: "string", format: "date-time" },
                serviceEndedAt: { type: ["string", "null"], format: "date-time" }, timeSpentMinutes: { type: "integer" }, status: { type: "string", enum: ["IN_PROGRESS", "COMPLETED"] }, createdAt: { type: "string", format: "date-time" },
            } },
            ActivityLogDetail: { allOf: [
                { $ref: "#/components/schemas/ActivityLogListItem" },
                { type: "object", required: ["reporter", "createdBy", "updatedAt"], properties: {
                    reporter: { type: "object", required: ["fullName", "email", "phone"], properties: { fullName: { type: "string" }, email: { type: "string", format: "email" }, phone: { type: ["string", "null"] } } },
                    createdBy: { $ref: "#/components/schemas/ActivityLogParticipant" }, updatedAt: { type: "string", format: "date-time" },
                } },
            ] },
            ActivityLogTicket: { type: "object", required: ["id", "code", "title"], properties: { id: { type: "string", format: "uuid" }, code: { type: "string" }, title: { type: "string" } } },
            ActivityLogParticipant: { type: "object", required: ["id", "fullName"], properties: { id: { type: "string", format: "uuid" }, fullName: { type: "string" } } },
            ActivityLogRevision: { type: "object", required: ["id", "changedBy", "previousData", "newData", "createdAt"], properties: {
                id: { type: "string", format: "uuid" }, changedBy: { $ref: "#/components/schemas/ActivityLogParticipant" },
                previousData: { $ref: "#/components/schemas/ActivityLogRevisionData" }, newData: { $ref: "#/components/schemas/ActivityLogRevisionData" }, createdAt: { type: "string", format: "date-time" },
            } },
            ActivityLogRevisionData: { type: "object", required: ["activity", "participantIds", "serviceStartedAt", "serviceEndedAt", "timeSpentMinutes", "status"], properties: {
                activity: { type: "string" }, participantIds: { type: "array", items: { type: "string", format: "uuid" } },
                serviceStartedAt: { type: "string", format: "date-time" }, serviceEndedAt: { type: ["string", "null"], format: "date-time" },
                timeSpentMinutes: { type: "integer" }, status: { type: "string", enum: ["IN_PROGRESS", "COMPLETED"] },
            } },
            PaginatedActivityLogsResponse: { type: "object", required: ["success", "data", "meta"], properties: {
                success: { const: true }, data: { type: "array", items: { $ref: "#/components/schemas/ActivityLogListItem" } },
                meta: { type: "object", required: ["page", "pageSize", "total", "totalPages"], properties: { page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" } } },
            } },
            InventoryItem: { type: "object", required: ["id", "type", "model", "assetCode", "color", "size", "building", "room", "serialNumber", "quantity", "notes", "isActive", "createdAt", "updatedAt"], properties: {
                id: { type: "string", format: "uuid" }, type: { type: "string", enum: ["COMPUTER", "PROJECTOR", "CONTROL", "ADAPTER"] },
                model: { type: ["string", "null"] }, assetCode: { type: ["string", "null"] }, color: { type: ["string", "null"] }, size: { type: ["string", "null"] },
                building: { type: ["string", "null"] }, room: { type: ["string", "null"] }, serialNumber: { type: ["string", "null"] },
                quantity: { type: "integer", minimum: 1 }, notes: { type: ["string", "null"] }, isActive: { type: "boolean" },
                createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
            } },
            InventoryListItem: { type: "object", required: ["id", "type", "model", "assetCode", "color", "size", "location", "serialNumber", "quantity", "isActive", "updatedAt"], properties: {
                id: { type: "string", format: "uuid" }, type: { type: "string", enum: ["COMPUTER", "PROJECTOR", "CONTROL", "ADAPTER"] },
                model: { type: ["string", "null"] }, assetCode: { type: ["string", "null"] }, color: { type: ["string", "null"] }, size: { type: ["string", "null"] },
                location: { type: "object", required: ["building", "room"], properties: { building: { type: ["string", "null"] }, room: { type: ["string", "null"] } } },
                serialNumber: { type: ["string", "null"] }, quantity: { type: "integer" }, isActive: { type: "boolean" }, updatedAt: { type: "string", format: "date-time" },
            } },
            CreateComputerInventoryRequest: { type: "object", additionalProperties: false, required: ["type", "model", "assetCode", "color", "size", "building", "serialNumber"], properties: {
                type: { const: "COMPUTER" }, model: { type: "string", minLength: 1 }, assetCode: { type: "string", minLength: 1 }, color: { type: "string", minLength: 1 }, size: { type: "string", minLength: 1 },
                building: { type: "string", minLength: 1 }, room: { type: ["string", "null"] }, serialNumber: { type: "string", minLength: 1 }, quantity: { type: "integer", const: 1 }, notes: { type: ["string", "null"] },
            } },
            CreateProjectorInventoryRequest: { type: "object", additionalProperties: false, required: ["type", "model", "assetCode", "color", "size"], properties: {
                type: { const: "PROJECTOR" }, model: { type: "string", minLength: 1 }, assetCode: { type: "string", minLength: 1 }, color: { type: "string", minLength: 1 }, size: { type: "string", minLength: 1 },
                building: { type: ["string", "null"] }, room: { type: ["string", "null"] }, serialNumber: { type: ["string", "null"] }, quantity: { type: "integer", const: 1 }, notes: { type: ["string", "null"] },
            } },
            CreateControlInventoryRequest: { type: "object", additionalProperties: false, required: ["type", "model", "quantity"], properties: {
                type: { const: "CONTROL" }, model: { type: "string", minLength: 1 }, assetCode: { type: ["string", "null"] }, color: { type: ["string", "null"] }, size: { type: ["string", "null"] },
                building: { type: ["string", "null"] }, room: { type: ["string", "null"] }, serialNumber: { type: ["string", "null"] }, quantity: { type: "integer", minimum: 1 }, notes: { type: ["string", "null"] },
            } },
            CreateAdapterInventoryRequest: { type: "object", additionalProperties: false, required: ["type", "model", "quantity"], properties: {
                type: { const: "ADAPTER" }, model: { type: "string", minLength: 1 }, assetCode: { type: ["string", "null"] }, color: { type: ["string", "null"] }, size: { type: ["string", "null"] },
                building: { type: ["string", "null"] }, room: { type: ["string", "null"] }, serialNumber: { type: ["string", "null"] }, quantity: { type: "integer", minimum: 1 }, notes: { type: ["string", "null"] },
            } },
            CreateInventoryRequest: { oneOf: [
                { $ref: "#/components/schemas/CreateComputerInventoryRequest" }, { $ref: "#/components/schemas/CreateProjectorInventoryRequest" },
                { $ref: "#/components/schemas/CreateControlInventoryRequest" }, { $ref: "#/components/schemas/CreateAdapterInventoryRequest" },
            ], discriminator: { propertyName: "type", mapping: { COMPUTER: "#/components/schemas/CreateComputerInventoryRequest", PROJECTOR: "#/components/schemas/CreateProjectorInventoryRequest", CONTROL: "#/components/schemas/CreateControlInventoryRequest", ADAPTER: "#/components/schemas/CreateAdapterInventoryRequest" } } },
            PatchInventoryRequest: { type: "object", additionalProperties: false, properties: {
                model: { type: "string", minLength: 1 }, assetCode: { type: ["string", "null"] }, color: { type: ["string", "null"] }, size: { type: ["string", "null"] },
                building: { type: ["string", "null"] }, room: { type: ["string", "null"] }, serialNumber: { type: ["string", "null"] }, quantity: { type: "integer", minimum: 1 }, notes: { type: ["string", "null"] },
            } },
            InventoryTicketHistoryItem: { type: "object", required: ["id", "code", "title", "category", "subcategory", "priority", "status", "reporter", "createdAt", "completedAt"], properties: {
                id: { type: "string", format: "uuid" }, code: { type: "string" }, title: { type: "string" },
                category: { type: "object", required: ["id", "name"], properties: { id: { type: "string", format: "uuid" }, name: { type: "string" } } },
                subcategory: { anyOf: [{ type: "object", required: ["id", "name"], properties: { id: { type: "string", format: "uuid" }, name: { type: "string" } } }, { type: "null" }] },
                priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] }, status: { type: "string", enum: ["OPEN", "IN_REVIEW", "IN_PROGRESS", "COMPLETED", "CANCELLED"] },
                reporter: { type: "object", required: ["fullName"], properties: { fullName: { type: "string", description: "Ticket.reporterNameSnapshot; no se resuelve desde User actual." } } },
                createdAt: { type: "string", format: "date-time" }, completedAt: { type: ["string", "null"], format: "date-time" },
            } },
            PaginatedInventoryResponse: { type: "object", required: ["success", "data", "meta"], properties: {
                success: { const: true }, data: { type: "array", items: { $ref: "#/components/schemas/InventoryListItem" } },
                meta: { type: "object", required: ["page", "pageSize", "total", "totalPages"], properties: { page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" } } },
            } },
            PaginatedInventoryTicketHistoryResponse: { type: "object", required: ["success", "data", "meta"], properties: {
                success: { const: true }, data: { type: "array", items: { $ref: "#/components/schemas/InventoryTicketHistoryItem" } },
                meta: { type: "object", required: ["page", "pageSize", "total", "totalPages"], properties: { page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" } } },
            } },
            StandardSuccessResponse: {
                type: "object", required: ["success", "data"],
                properties: { success: { const: true }, data: {} },
            },
            StandardErrorResponse: {
                type: "object", required: ["success", "error", "requestId"],
                properties: {
                    success: { const: false },
                    error: { type: "object", required: ["code", "message"], properties: {
                        code: { type: "string" }, message: { type: "string" },
                        fields: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } },
                    } },
                    requestId: { type: "string" },
                },
            },
            ValidationErrorResponse: { $ref: "#/components/schemas/StandardErrorResponse" },
            User: {
                type: "object", required: ["id", "email", "fullName", "institutionalId", "phone", "role", "communityType", "supportAreas", "skills", "avatarUrl"],
                properties: {
                    id: { type: "string", format: "uuid" }, email: { type: "string", format: "email" },
                    fullName: { type: "string" }, institutionalId: { type: "string" }, phone: { type: ["string", "null"] },
                    role: { type: "string", enum: ["USER", "SUPPORT", "SUB_MANAGER", "ADMIN"] },
                    communityType: { type: "string", enum: ["STUDENT", "TEACHER", "ADMINISTRATIVE"] },
                    supportAreas: { type: "array", items: { type: "string" } }, skills: { type: "array", items: { type: "string" } },
                    avatarUrl: { type: ["string", "null"] },
                },
            },
            Category: {
                type: "object", required: ["id", "code", "name", "supportArea", "defaultPriority", "requiresSoftwareDetails", "isActive", "subcategories"],
                properties: {
                    id: { type: "string", format: "uuid" }, code: { type: "string", pattern: "^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$" },
                    name: { type: "string" }, supportArea: { type: "string", enum: ["HARDWARE", "SOFTWARE", "NETWORKS", "ADMINISTRATIVE"] },
                    defaultPriority: { type: ["string", "null"], enum: ["LOW", "MEDIUM", "HIGH", null] },
                    requiresSoftwareDetails: { type: "boolean" }, isActive: { type: "boolean" },
                    subcategories: { type: "array", items: { $ref: "#/components/schemas/Subcategory" } },
                },
            },
            Subcategory: {
                type: "object", required: ["id", "code", "name", "priority", "isActive"],
                properties: {
                    id: { type: "string", format: "uuid" }, categoryId: { type: "string", format: "uuid" },
                    code: { type: "string" }, name: { type: "string" },
                    priority: { type: ["string", "null"], enum: ["LOW", "MEDIUM", "HIGH", null] },
                    isActive: { type: "boolean" },
                },
            },
            SupportSuggestion: {
                type: "object", required: ["id", "title", "description"],
                properties: { id: { type: "string", format: "uuid" }, title: { type: "string" }, description: { type: "string" } },
            },
            TicketFormCatalog: {
                type: "object", required: ["categories", "maxActiveTickets"],
                properties: {
                    categories: { type: "array", items: { $ref: "#/components/schemas/TicketFormCategory" } },
                    maxActiveTickets: { type: "integer", const: 10 },
                },
            },
            TicketFormCategory: {
                type: "object", required: ["id", "code", "name", "supportArea", "defaultPriority", "requiresSoftwareDetails", "subcategories"],
                properties: {
                    id: { type: "string", format: "uuid" }, code: { type: "string" }, name: { type: "string" },
                    supportArea: { type: "string", enum: ["HARDWARE", "SOFTWARE", "NETWORKS", "ADMINISTRATIVE"] },
                    defaultPriority: { type: ["string", "null"], enum: ["LOW", "MEDIUM", "HIGH", null] },
                    requiresSoftwareDetails: { type: "boolean" },
                    subcategories: { type: "array", items: { $ref: "#/components/schemas/TicketFormSubcategory" } },
                },
            },
            TicketFormSubcategory: {
                type: "object", required: ["id", "code", "name", "priority"],
                properties: {
                    id: { type: "string", format: "uuid" }, code: { type: "string" }, name: { type: "string" },
                    priority: { type: ["string", "null"], enum: ["LOW", "MEDIUM", "HIGH", null] },
                },
            },
            CreateTicketRequest: {
                type: "object", additionalProperties: false,
                required: ["title", "categoryId", "building", "description"],
                properties: {
                    title: { type: "string", minLength: 1, maxLength: 150 },
                    categoryId: { type: "string", format: "uuid" },
                    subcategoryId: { type: ["string", "null"], format: "uuid", description: "Obligatoria si la categoría tiene subcategorías activas." },
                    building: { type: "string", minLength: 1, maxLength: 120 },
                    room: { type: ["string", "null"], maxLength: 80 },
                    description: { type: "string", minLength: 1, description: "Máximo 50 palabras." },
                    contactPhone: { type: ["string", "null"], maxLength: 40 },
                    inventoryItemId: { type: ["string", "null"], format: "uuid" },
                    software: { type: "object", additionalProperties: false,
                        required: ["name", "version", "downloadUrl", "coordinationApprovalReference"],
                        properties: {
                            name: { type: "string" }, version: { type: "string" },
                            downloadUrl: { type: "string", format: "uri" },
                            coordinationApprovalReference: { type: "string" },
                        },
                    },
                },
            },
            TicketCategorySummary: { type: "object", required: ["id", "code", "name"], properties: {
                id: { type: "string", format: "uuid" }, code: { type: "string" }, name: { type: "string" },
            } },
            TicketSubcategorySummary: { type: "object", required: ["id", "code", "name"], properties: {
                id: { type: "string", format: "uuid" }, code: { type: "string" }, name: { type: "string" },
            } },
            CreatedTicket: { type: "object", required: ["id", "code", "title", "description", "category", "subcategory", "location", "priority", "status", "assignee", "createdAt"], properties: {
                id: { type: "string", format: "uuid" }, code: { type: "string", pattern: "^TK-[0-9]{6,}$" },
                title: { type: "string" }, description: { type: "string" },
                category: { $ref: "#/components/schemas/TicketCategorySummary" },
                subcategory: { anyOf: [{ $ref: "#/components/schemas/TicketSubcategorySummary" }, { type: "null" }] },
                location: { type: "object", required: ["building", "room"], properties: { building: { type: "string" }, room: { type: ["string", "null"] } } },
                priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] }, status: { const: "OPEN" },
                assignee: { type: "null" }, createdAt: { type: "string", format: "date-time" },
            } },
            TicketListItem: { type: "object", required: ["id", "code", "title", "category", "subcategory", "location", "priority", "status", "assignee", "createdAt"], properties: {
                id: { type: "string", format: "uuid" }, code: { type: "string" }, title: { type: "string" },
                category: { type: "object", properties: { id: { type: "string", format: "uuid" }, name: { type: "string" } } },
                subcategory: { anyOf: [{ type: "object", properties: { id: { type: "string", format: "uuid" }, name: { type: "string" } } }, { type: "null" }] },
                location: { type: "object", properties: { building: { type: "string" }, room: { type: ["string", "null"] } } },
                priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
                status: { type: "string", enum: ["OPEN", "IN_REVIEW", "IN_PROGRESS", "COMPLETED", "CANCELLED"] },
                assignee: { anyOf: [{ type: "object", properties: { id: { type: "string", format: "uuid" }, fullName: { type: "string" } } }, { type: "null" }] },
                createdAt: { type: "string", format: "date-time" },
            } },
            TicketDetail: { type: "object", required: ["id", "code", "title", "description", "reporter", "category", "subcategory", "location", "priority", "status", "assignee", "inventoryItem", "software", "createdAt", "updatedAt", "assignedAt", "completedAt", "cancelledAt"], properties: {
                id: { type: "string", format: "uuid" }, code: { type: "string" }, title: { type: "string" }, description: { type: "string" },
                reporter: { type: "object", properties: { id: { type: "string", format: "uuid" }, fullName: { type: "string" }, email: { type: "string", format: "email" }, phone: { type: ["string", "null"] }, communityType: { type: "string" } } },
                category: { type: "object", properties: { id: { type: "string", format: "uuid" }, code: { type: "string" }, name: { type: "string" }, supportArea: { type: "string" } } },
                subcategory: { anyOf: [{ $ref: "#/components/schemas/TicketSubcategorySummary" }, { type: "null" }] },
                location: { type: "object", properties: { building: { type: "string" }, room: { type: ["string", "null"] } } },
                priority: { type: "string" }, status: { type: "string" },
                assignee: { anyOf: [{ type: "object", properties: { id: { type: "string", format: "uuid" }, fullName: { type: "string" } } }, { type: "null" }] },
                inventoryItem: { anyOf: [{ type: "object", properties: { id: { type: "string", format: "uuid" }, type: { type: "string" }, model: { type: ["string", "null"] }, assetCode: { type: ["string", "null"] } } }, { type: "null" }] },
                software: { anyOf: [{ type: "object", properties: { name: { type: "string" }, version: { type: "string" }, downloadUrl: { type: "string", format: "uri" }, coordinationApprovalReference: { type: "string" } } }, { type: "null" }] },
                createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
                assignedAt: { type: ["string", "null"], format: "date-time" }, completedAt: { type: ["string", "null"], format: "date-time" }, cancelledAt: { type: ["string", "null"], format: "date-time" },
            } },
            TicketEvent: { type: "object", required: ["id", "type", "actor", "fromStatus", "toStatus", "metadata", "createdAt"], properties: {
                id: { type: "string", format: "uuid" }, type: { type: "string", enum: ["CREATED", "ASSIGNED", "UNASSIGNED", "STATUS_CHANGED", "PRIORITY_CHANGED", "CANCELLED"] },
                actor: { anyOf: [{ type: "object", properties: { id: { type: "string", format: "uuid" }, fullName: { type: "string" } } }, { type: "null" }] },
                fromStatus: { type: ["string", "null"] }, toStatus: { type: ["string", "null"] },
                metadata: { type: "object" }, createdAt: { type: "string", format: "date-time" },
            } },
            PaginatedTicketsResponse: { type: "object", required: ["success", "data", "meta"], properties: {
                success: { const: true }, data: { type: "array", items: { $ref: "#/components/schemas/TicketListItem" } },
                meta: { type: "object", required: ["page", "pageSize", "total", "totalPages"], properties: {
                    page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" },
                } },
            } },
            CompleteProfileInput: {
                type: "object", required: ["institutionalId", "communityType"], additionalProperties: false,
                properties: {
                    institutionalId: { type: "string" },
                    communityType: { type: "string", enum: ["STUDENT", "TEACHER", "ADMINISTRATIVE"] },
                    phone: { type: ["string", "null"] },
                },
            },
            UpdateUserProfileInput: {
                type: "object", minProperties: 1, additionalProperties: false,
                properties: { fullName: { type: "string" }, phone: { type: ["string", "null"] } },
            },
            CreateCategoryInput: {
                type: "object", required: ["code", "name", "supportArea"], additionalProperties: false,
                properties: {
                    code: { type: "string", pattern: "^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$" }, name: { type: "string" },
                    supportArea: { type: "string", enum: ["HARDWARE", "SOFTWARE", "NETWORKS", "ADMINISTRATIVE"] },
                    defaultPriority: { type: ["string", "null"], enum: ["LOW", "MEDIUM", "HIGH", null] },
                    requiresSoftwareDetails: { type: "boolean", default: false },
                },
            },
            UpdateCategoryInput: {
                type: "object", minProperties: 1, additionalProperties: false,
                properties: {
                    name: { type: "string" }, supportArea: { type: "string", enum: ["HARDWARE", "SOFTWARE", "NETWORKS", "ADMINISTRATIVE"] },
                    defaultPriority: { type: ["string", "null"], enum: ["LOW", "MEDIUM", "HIGH", null] },
                    requiresSoftwareDetails: { type: "boolean" }, isActive: { type: "boolean" },
                },
            },
            CreateSubcategoryInput: {
                type: "object", required: ["code", "name"], additionalProperties: false,
                properties: {
                    code: { type: "string", pattern: "^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$" },
                    name: { type: "string" }, priority: { type: ["string", "null"], enum: ["LOW", "MEDIUM", "HIGH", null] },
                },
            },
            UpdateSubcategoryInput: {
                type: "object", minProperties: 1, additionalProperties: false,
                properties: {
                    name: { type: "string" }, priority: { type: ["string", "null"], enum: ["LOW", "MEDIUM", "HIGH", null] },
                    isActive: { type: "boolean" },
                },
            },
        },
    },
} as const;

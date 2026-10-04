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

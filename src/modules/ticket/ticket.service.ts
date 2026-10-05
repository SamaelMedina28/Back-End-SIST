import { createHash } from "node:crypto";
import { Role, TicketPriority, TicketStatus, type SupportArea } from "../../../generated/prisma/client.js";
import { AppError } from "../../common/errors/app-error.js";
import { resolveEffectivePriority } from "../category/category.service.js";
import type { CatalogRepository } from "../category/category.types.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import type { TicketCreateInput, TicketEventRecord, TicketQuery, TicketRecord, TicketRepository, TicketMutationSnapshot, MutationActor, TicketListSource } from "./ticket.types.js";
import { supportAreaTicketFilter } from "./ticket.scope.js";

export function normalizeLocation(value: string | null | undefined): string | null {
    return value == null ? null : value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ") || null;
}

export function ticketDuplicateKey(input: Pick<TicketCreateInput, "categoryId" | "subcategoryId" | "building" | "room">): string {
    // JSON preserva límites entre componentes y diferencia null de strings.
    const canonical = JSON.stringify([
        input.categoryId, input.subcategoryId ?? null, normalizeLocation(input.building), normalizeLocation(input.room),
    ]);
    return createHash("sha256").update(canonical).digest("hex");
}

const smallCategory = (value: TicketRecord["category"]) => ({ id: value.id, code: value.code, name: value.name });
const smallSubcategory = (value: TicketRecord["subcategory"]) => value ? ({ id: value.id, code: value.code, name: value.name }) : null;
const assignee = (value: TicketRecord["assignee"]) => value ? ({ id: value.id, fullName: value.fullName }) : null;
const location = (value: Pick<TicketRecord, "building" | "room">) => ({ building: value.building, room: value.room });
const ACTIVE_STATUSES: TicketStatus[] = [TicketStatus.OPEN, TicketStatus.IN_REVIEW, TicketStatus.IN_PROGRESS];
const transitions: Record<TicketStatus, TicketStatus[]> = {
    OPEN: [TicketStatus.IN_REVIEW, TicketStatus.IN_PROGRESS, TicketStatus.CANCELLED],
    IN_REVIEW: [TicketStatus.IN_PROGRESS, TicketStatus.CANCELLED],
    IN_PROGRESS: [TicketStatus.COMPLETED, TicketStatus.CANCELLED],
    COMPLETED: [], CANCELLED: [],
};
const fail = (status: number, code: string, message: string): never => { throw new AppError(status, code, message); };
const requireActor = (actor: MutationActor | null): MutationActor => {
    if (!actor || !actor.isActive) return fail(401, "INVALID_SESSION", "La sesión no es válida.");
    return actor;
};
const responseEnvelope = (data: Record<string, unknown>) => ({ success: true as const, data });

function validateIdempotencyKey(key: string | undefined): void {
    if (key !== undefined && !/^[\x21-\x7e]{1,200}$/u.test(key)) {
        throw new AppError(422, "VALIDATION_ERROR", "El encabezado Idempotency-Key no es válido.", { "Idempotency-Key": ["Debe contener entre 1 y 200 caracteres ASCII imprimibles sin espacios."] });
    }
}

function requireAdmin(actor: MutationActor): void {
    if (actor.role !== Role.ADMIN) fail(403, "FORBIDDEN", "Solo administración puede realizar esta acción.");
}

function requireSupport(actor: MutationActor): void {
    if (actor.role !== Role.SUPPORT && actor.role !== Role.SUB_MANAGER) fail(403, "FORBIDDEN", "Se requiere un rol de soporte.");
}

function supportAreaIncludes(actor: MutationActor, area: SupportArea): boolean {
    return actor.role === Role.ADMIN || actor.supportAreas.includes(area);
}

function statusHash(ticketId: string, status: TicketStatus, note: string | undefined): string {
    return createHash("sha256").update(JSON.stringify([ticketId, status, note ?? null])).digest("hex");
}

function statusData(ticket: TicketMutationSnapshot) {
    return { id: ticket.id, code: ticket.code, status: ticket.status, updatedAt: ticket.updatedAt.toISOString() };
}

function assignmentData(ticket: TicketMutationSnapshot) {
    return { id: ticket.id, code: ticket.code, assignee: ticket.assignee, assignedAt: ticket.assignedAt?.toISOString() ?? null };
}

function assertActive(ticket: TicketMutationSnapshot): void {
    if (!ACTIVE_STATUSES.includes(ticket.status)) fail(409, "TICKET_NOT_ACTIVE", "No se puede modificar un ticket que ya terminó.");
}

export function toCreatedTicket(ticket: TicketRecord) {
    return {
        id: ticket.id, code: ticket.code, title: ticket.title, description: ticket.description,
        category: smallCategory(ticket.category), subcategory: smallSubcategory(ticket.subcategory),
        location: location(ticket), priority: ticket.priority, status: ticket.status,
        assignee: assignee(ticket.assignee), createdAt: ticket.createdAt.toISOString(),
    };
}

export function toTicketListItem(ticket: TicketListSource) {
    return {
        id: ticket.id, code: ticket.code, title: ticket.title,
        category: { id: ticket.category.id, name: ticket.category.name },
        subcategory: ticket.subcategory ? { id: ticket.subcategory.id, name: ticket.subcategory.name } : null,
        location: location(ticket), priority: ticket.priority, status: ticket.status,
        assignee: assignee(ticket.assignee), createdAt: ticket.createdAt.toISOString(),
    };
}

export function toTicketDetail(ticket: TicketRecord) {
    return {
        id: ticket.id, code: ticket.code, title: ticket.title, description: ticket.description,
        reporter: {
            id: ticket.reporterId, fullName: ticket.reporterNameSnapshot, email: ticket.reporterEmailSnapshot,
            phone: ticket.reporterPhoneSnapshot, communityType: ticket.reporterCommunityTypeSnapshot,
        },
        category: { ...smallCategory(ticket.category), supportArea: ticket.category.supportArea },
        subcategory: smallSubcategory(ticket.subcategory), location: location(ticket),
        priority: ticket.priority, status: ticket.status, assignee: assignee(ticket.assignee),
        inventoryItem: ticket.inventoryItem ? {
            id: ticket.inventoryItem.id, type: ticket.inventoryItem.type,
            model: ticket.inventoryItem.model, assetCode: ticket.inventoryItem.assetCode,
        } : null,
        software: ticket.softwareName ? {
            name: ticket.softwareName, version: ticket.softwareVersion,
            downloadUrl: ticket.softwareDownloadUrl,
            coordinationApprovalReference: ticket.coordinationApprovalReference,
        } : null,
        createdAt: ticket.createdAt.toISOString(), updatedAt: ticket.updatedAt.toISOString(),
        assignedAt: ticket.assignedAt?.toISOString() ?? null,
        completedAt: ticket.completedAt?.toISOString() ?? null,
        cancelledAt: ticket.cancelledAt?.toISOString() ?? null,
    };
}

export function toTicketEvent(event: TicketEventRecord) {
    return {
        id: event.id, type: event.type,
        actor: event.actor ? { id: event.actor.id, fullName: event.actor.fullName } : null,
        fromStatus: event.fromStatus, toStatus: event.toStatus, metadata: event.metadata,
        createdAt: event.createdAt.toISOString(),
    };
}

export class TicketService {
    constructor(private readonly tickets: TicketRepository, private readonly catalog: CatalogRepository) {}

    async create(user: AuthenticatedUser, input: TicketCreateInput) {
        const category = await this.catalog.findCategoryById(input.categoryId);
        if (!category) throw new AppError(404, "CATEGORY_NOT_FOUND", "La categoría no existe.");
        if (!category.isActive) throw new AppError(409, "CATEGORY_INACTIVE", "La categoría está inactiva.");

        let subcategory = null;
        if (input.subcategoryId) {
            subcategory = await this.catalog.findSubcategoryById(input.subcategoryId);
            if (!subcategory) throw new AppError(404, "SUBCATEGORY_NOT_FOUND", "La subcategoría no existe.");
            if (!subcategory.isActive) throw new AppError(409, "SUBCATEGORY_INACTIVE", "La subcategoría está inactiva.");
            if (subcategory.categoryId !== category.id) {
                throw new AppError(422, "SUBCATEGORY_CATEGORY_MISMATCH", "La subcategoría no pertenece a la categoría seleccionada.");
            }
        } else if (category.subcategories.some((item) => item.isActive)) {
            throw new AppError(422, "VALIDATION_ERROR", "Debes seleccionar una subcategoría.", { subcategoryId: ["Es obligatoria para esta categoría."] });
        }

        if (category.requiresSoftwareDetails) {
            if (user.communityType !== "TEACHER") {
                throw new AppError(403, "SOFTWARE_REQUEST_REQUIRES_TEACHER", "Las solicitudes de instalación de software requieren una cuenta de docente.");
            }
            if (!input.software) {
                throw new AppError(422, "VALIDATION_ERROR", "Faltan los datos del software.", { software: ["Es obligatorio."] });
            }
        } else if (input.software) {
            throw new AppError(422, "VALIDATION_ERROR", "La categoría no admite datos de software.", { software: ["No está permitido."] });
        }

        if (input.inventoryItemId) {
            const item = await this.tickets.findInventoryItem(input.inventoryItemId);
            if (!item) throw new AppError(404, "INVENTORY_ITEM_NOT_FOUND", "El artículo de inventario no existe.");
            if (!item.isActive) throw new AppError(409, "INVENTORY_ITEM_INACTIVE", "El artículo de inventario está inactivo.");
        }

        const priority = resolveEffectivePriority(subcategory?.priority, category.defaultPriority);
        if (!priority) throw new AppError(409, "TICKET_PRIORITY_NOT_CONFIGURED", "La categoría seleccionada todavía no tiene una prioridad configurada.");
        const normalized: TicketCreateInput = {
            title: input.title, description: input.description, categoryId: input.categoryId,
            subcategoryId: input.subcategoryId ?? null, building: input.building, room: input.room ?? null,
            contactPhone: input.contactPhone ?? null, inventoryItemId: input.inventoryItemId ?? null,
            ...(input.software ? { software: input.software } : {}),
        };
        const created = await this.tickets.createWithCreatedEvent(user, normalized, priority, ticketDuplicateKey(normalized));
        return toCreatedTicket(created);
    }

    async list(user: AuthenticatedUser, query: TicketQuery) {
        if (user.role === Role.USER && (query.assignment || query.assignedTo || query.supportArea)) {
            throw new AppError(403, "FORBIDDEN", "Estos filtros requieren un rol de soporte o administración.");
        }
        if ((user.role === Role.SUPPORT || user.role === Role.SUB_MANAGER) &&
            query.supportArea && !user.supportAreas.includes(query.supportArea as AuthenticatedUser["supportAreas"][number])) {
            throw new AppError(403, "SUPPORT_AREA_FORBIDDEN", "No tienes acceso a esa área de soporte.");
        }
        const filters: Record<string, unknown>[] = [];
        if (user.role === Role.USER) filters.push({ reporterId: user.id });
        else if (user.role !== Role.ADMIN) filters.push(supportAreaTicketFilter(user.supportAreas));
        if (query.search) filters.push({ OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { title: { contains: query.search, mode: "insensitive" } },
        ] });
        if (query.status) filters.push({ status: query.status });
        if (query.priority) filters.push({ priority: query.priority });
        if (query.categoryId) filters.push({ categoryId: query.categoryId });
        if (query.subcategoryId) filters.push({ subcategoryId: query.subcategoryId });
        if (query.supportArea) filters.push({ category: { supportArea: query.supportArea } });
        if (query.assignedTo) filters.push({ assigneeId: query.assignedTo });
        if (query.assignment === "mine") filters.push({ assigneeId: user.id });
        if (query.assignment === "unassigned") filters.push({ assigneeId: null });
        if (query.assignment === "assigned") filters.push({ assigneeId: { not: null } });
        if (query.createdFrom || query.createdTo) filters.push({ createdAt: {
            ...(query.createdFrom ? { gte: query.createdFrom } : {}),
            ...(query.createdTo ? { lte: query.createdTo } : {}),
        } });
        const { records, total } = await this.tickets.list({ AND: filters }, query);
        return {
            data: records.map(toTicketListItem),
            meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
        };
    }

    private async visibleTicket(user: AuthenticatedUser, id: string): Promise<TicketRecord> {
        const ticket = await this.tickets.findById(id);
        if (!ticket) throw new AppError(404, "TICKET_NOT_FOUND", "El ticket no existe.");
        const visible = user.role === Role.ADMIN ||
            (user.role === Role.USER && ticket.reporterId === user.id) ||
            ((user.role === Role.SUPPORT || user.role === Role.SUB_MANAGER) &&
                user.supportAreas.includes(ticket.category.supportArea as AuthenticatedUser["supportAreas"][number]));
        if (!visible) throw new AppError(403, "FORBIDDEN_TICKET", "No tienes acceso a este ticket.");
        return ticket;
    }

    async detail(user: AuthenticatedUser, id: string) {
        return toTicketDetail(await this.visibleTicket(user, id));
    }

    async events(user: AuthenticatedUser, id: string) {
        await this.visibleTicket(user, id);
        return (await this.tickets.events(id)).map(toTicketEvent);
    }

    async assignSelf(user: AuthenticatedUser, id: string) {
        return this.tickets.withLockedTicket(id, async (tx) => {
            const ticket = tx.ticket;
            if (!ticket) throw new AppError(404, "TICKET_NOT_FOUND", "El ticket no existe.");
            assertActive(ticket);
            const actor = requireActor(await tx.findUserForAssignment(user.id));
            requireSupport(actor);
            if (!supportAreaIncludes(actor, ticket.category.supportArea)) fail(403, "SUPPORT_AREA_FORBIDDEN", "El ticket está fuera de tus áreas de soporte.");
            if (ticket.assigneeId) fail(409, "TICKET_ALREADY_ASSIGNED", "El ticket ya tiene una persona asignada.");
            const now = new Date();
            const updated = await tx.updateTicket({ assigneeId: actor.id, assignedAt: now });
            await tx.createEvent({ actorId: actor.id, type: "ASSIGNED", metadata: { assigneeId: actor.id, assignmentType: "SELF" } });
            return assignmentData(updated);
        });
    }

    async assignAdmin(user: AuthenticatedUser, id: string, assigneeId: string) {
        return this.tickets.withLockedTicket(id, async (tx) => {
            const ticket = tx.ticket;
            if (!ticket) throw new AppError(404, "TICKET_NOT_FOUND", "El ticket no existe.");
            const actor = requireActor(await tx.findUser(user.id));
            requireAdmin(actor);
            assertActive(ticket);
            const target = await tx.findUserForAssignment(assigneeId);
            if (!target) throw new AppError(404, "ASSIGNEE_NOT_FOUND", "La persona asignada no existe.");
            if (!target.isActive) fail(409, "ASSIGNEE_INACTIVE", "La persona asignada está inactiva.");
            if (target.role !== Role.SUPPORT && target.role !== Role.SUB_MANAGER) fail(409, "INVALID_ASSIGNEE_ROLE", "La persona debe tener un rol de soporte.");
            if (!target.supportAreas.includes(ticket.category.supportArea)) fail(409, "ASSIGNEE_AREA_MISMATCH", "La persona no pertenece al área de soporte del ticket.");
            if (ticket.assigneeId === target.id) return assignmentData(ticket);
            const updated = await tx.updateTicket({ assigneeId: target.id, assignedAt: new Date() });
            await tx.createEvent({ actorId: actor.id, type: "ASSIGNED", metadata: {
                assignmentType: "ADMIN", previousAssigneeId: ticket.assigneeId, assigneeId: target.id,
            } });
            return assignmentData(updated);
        });
    }

    async unassignAdmin(user: AuthenticatedUser, id: string): Promise<void> {
        await this.tickets.withLockedTicket(id, async (tx) => {
            const ticket = tx.ticket;
            if (!ticket) throw new AppError(404, "TICKET_NOT_FOUND", "El ticket no existe.");
            const actor = requireActor(await tx.findUser(user.id));
            requireAdmin(actor);
            assertActive(ticket);
            if (!ticket.assigneeId) return;
            await tx.updateTicket({ assigneeId: null, assignedAt: null });
            await tx.createEvent({ actorId: actor.id, type: "UNASSIGNED", metadata: { previousAssigneeId: ticket.assigneeId } });
        });
    }

    async changeStatus(user: AuthenticatedUser, id: string, status: TicketStatus, note: string | undefined, key: string | undefined) {
        validateIdempotencyKey(key);
        return this.tickets.withLockedTicket(id, async (tx) => {
            const ticket = tx.ticket;
            if (!ticket) throw new AppError(404, "TICKET_NOT_FOUND", "El ticket no existe.");
            const actor = requireActor(await tx.findUser(user.id));
            if (actor.role !== Role.ADMIN && actor.role !== Role.SUPPORT && actor.role !== Role.SUB_MANAGER) fail(403, "FORBIDDEN", "No tienes permisos para cambiar el estado.");
            if (!supportAreaIncludes(actor, ticket.category.supportArea)) fail(403, "SUPPORT_AREA_FORBIDDEN", "El ticket está fuera de tus áreas de soporte.");
            if (actor.role !== Role.ADMIN && ticket.assigneeId !== actor.id) fail(403, "TICKET_NOT_ASSIGNED_TO_YOU", "Solo puedes cambiar el estado de tickets asignados a ti.");

            const scope = `PATCH:/tickets/${id}/status`;
            const hash = statusHash(id, status, note);
            if (key) {
                const previous = await tx.findIdempotencyRecord(actor.id, scope, key);
                if (previous && previous.expiresAt > new Date()) {
                    if (previous.requestHash !== hash) fail(409, "IDEMPOTENCY_CONFLICT", "La clave ya se utilizó con una solicitud diferente.");
                    return previous.responseBody;
                }
                if (previous) await tx.deleteIdempotencyRecord(previous.id);
            }

            assertActive(ticket);
            if (status !== ticket.status && !transitions[ticket.status].includes(status)) {
                fail(409, "INVALID_STATUS_TRANSITION", "La transición de estado solicitada no está permitida.");
            }
            let result: Record<string, unknown>;
            if (status === ticket.status) result = statusData(ticket);
            else {
                const now = new Date();
                const data = status === TicketStatus.COMPLETED
                    ? { status, completedAt: now, cancelledAt: null, cancellationReason: null, duplicateKey: null }
                    : status === TicketStatus.CANCELLED
                        ? { status, cancelledAt: now, cancellationReason: note!, completedAt: null, duplicateKey: null }
                        : { status, completedAt: null, cancelledAt: null, cancellationReason: null };
                const updated = await tx.updateTicket(data);
                await tx.createEvent({ actorId: actor.id, type: "STATUS_CHANGED", fromStatus: ticket.status, toStatus: status,
                    metadata: note ? (status === TicketStatus.CANCELLED ? { note, cancellationReason: note } : { note }) : {} });
                result = statusData(updated);
            }
            const envelope = responseEnvelope(result);
            if (key) await tx.createIdempotencyRecord({
                userId: actor.id, key, scope, requestHash: hash, responseStatus: 200, responseBody: envelope,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            });
            return envelope;
        });
    }

    async changePriority(user: AuthenticatedUser, id: string, priority: TicketPriority, reason: string) {
        return this.tickets.withLockedTicket(id, async (tx) => {
            const ticket = tx.ticket;
            if (!ticket) throw new AppError(404, "TICKET_NOT_FOUND", "El ticket no existe.");
            const actor = requireActor(await tx.findUser(user.id));
            requireAdmin(actor);
            assertActive(ticket);
            if (priority === ticket.priority) return { id: ticket.id, code: ticket.code, priority: ticket.priority, updatedAt: ticket.updatedAt.toISOString() };
            const updated = await tx.updateTicket({ priority });
            await tx.createEvent({ actorId: actor.id, type: "PRIORITY_CHANGED", metadata: { previousPriority: ticket.priority, priority, reason } });
            return { id: updated.id, code: updated.code, priority: updated.priority, updatedAt: updated.updatedAt.toISOString() };
        });
    }
}

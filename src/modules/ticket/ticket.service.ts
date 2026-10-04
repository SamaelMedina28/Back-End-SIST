import { createHash } from "node:crypto";
import { Role } from "../../../generated/prisma/client.js";
import { AppError } from "../../common/errors/app-error.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import { resolveEffectivePriority } from "../category/category.service.js";
import type { CatalogRepository } from "../category/category.types.js";
import type { TicketCreateInput, TicketEventRecord, TicketQuery, TicketRecord, TicketRepository } from "./ticket.types.js";

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
const location = (value: TicketRecord) => ({ building: value.building, room: value.room });

export function toCreatedTicket(ticket: TicketRecord) {
    return {
        id: ticket.id, code: ticket.code, title: ticket.title, description: ticket.description,
        category: smallCategory(ticket.category), subcategory: smallSubcategory(ticket.subcategory),
        location: location(ticket), priority: ticket.priority, status: ticket.status,
        assignee: assignee(ticket.assignee), createdAt: ticket.createdAt.toISOString(),
    };
}

export function toTicketListItem(ticket: TicketRecord) {
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
        else if (user.role !== Role.ADMIN) filters.push({ category: { supportArea: { in: user.supportAreas } } });
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
}

import { InventoryType } from "../../../generated/prisma/client.js";
import { AppError } from "../../common/errors/app-error.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import type { InventoryCreateBody, InventoryPatchBody } from "./inventory.schema.js";
import type { InventoryCreateInput, InventoryHistoryQuery, InventoryListQuery, InventoryPatchInput, InventoryRecord, InventoryRepository } from "./inventory.types.js";

function fail(status: number, code: string, message: string): never {
    throw new AppError(status, code, message);
}

function checkUniqueConflict(error: unknown): boolean {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") return false;
    const meta = "meta" in error && error.meta && typeof error.meta === "object"
        ? error.meta as { target?: unknown }
        : undefined;
    const targetValue = meta?.target;
    const target = Array.isArray(targetValue) ? targetValue.join(",") : String(targetValue ?? "");
    const diagnostic = `${target} ${"message" in error ? String(error.message) : ""}`;
    if (diagnostic.includes("assetCode")) fail(409, "INVENTORY_ASSET_CODE_ALREADY_EXISTS", "El código patrimonial ya está registrado.");
    if (diagnostic.includes("serialNumber")) fail(409, "INVENTORY_SERIAL_NUMBER_ALREADY_EXISTS", "El número de serie ya está registrado.");
    return true;
}

function validateByType(item: InventoryRecord | InventoryCreateInput): void {
    const missing: string[] = [];
    if (!item.model?.trim()) missing.push("model");
    if (item.type === InventoryType.COMPUTER) {
        for (const field of ["assetCode", "color", "size", "building", "serialNumber"] as const) {
            if (!item[field]?.trim()) missing.push(field);
        }
        if (item.quantity !== 1) missing.push("quantity");
    } else if (item.type === InventoryType.PROJECTOR) {
        for (const field of ["assetCode", "color", "size"] as const) {
            if (!item[field]?.trim()) missing.push(field);
        }
        if (item.quantity !== 1) missing.push("quantity");
    } else if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        missing.push("quantity");
    }
    if (missing.length) throw new AppError(422, "VALIDATION_ERROR", "El inventario no cumple los campos requeridos para su tipo.",
        Object.fromEntries(missing.map((field) => [field, [field === "quantity" ? "La cantidad no es válida para este tipo." : "Este campo es obligatorio para el tipo seleccionado."]])));
}

function toCreateInput(body: InventoryCreateBody): InventoryCreateInput {
    return {
        type: body.type,
        model: body.model,
        assetCode: body.assetCode,
        color: body.color,
        size: body.size,
        building: body.building,
        room: body.room,
        serialNumber: body.serialNumber,
        quantity: body.quantity,
        notes: body.notes,
    };
}

export function toInventoryListItem(record: InventoryRecord) {
    return {
        id: record.id,
        type: record.type,
        model: record.model,
        assetCode: record.assetCode,
        color: record.color,
        size: record.size,
        location: { building: record.building, room: record.room },
        serialNumber: record.serialNumber,
        quantity: record.quantity,
        isActive: record.isActive,
        updatedAt: record.updatedAt.toISOString(),
    };
}

export function toInventoryDetail(record: InventoryRecord) {
    return {
        id: record.id,
        type: record.type,
        model: record.model,
        assetCode: record.assetCode,
        color: record.color,
        size: record.size,
        building: record.building,
        room: record.room,
        serialNumber: record.serialNumber,
        quantity: record.quantity,
        notes: record.notes,
        isActive: record.isActive,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
    };
}

export function toInventoryHistoryItem(record: import("./inventory.types.js").InventoryHistoryRecord) {
    return {
        id: record.id,
        code: record.code,
        title: record.title,
        category: record.category,
        subcategory: record.subcategory,
        priority: record.priority,
        status: record.status,
        reporter: { fullName: record.reporterNameSnapshot },
        createdAt: record.createdAt.toISOString(),
        completedAt: record.completedAt?.toISOString() ?? null,
    };
}

function sameValue(record: InventoryRecord, patch: InventoryPatchInput): boolean {
    return Object.entries(patch).every(([key, value]) => record[key as keyof InventoryRecord] === value);
}

export class InventoryService {
    constructor(private readonly inventory: InventoryRepository) {}

    async create(_user: AuthenticatedUser, body: InventoryCreateBody) {
        const input = toCreateInput(body);
        validateByType(input);
        try {
            return toInventoryDetail(await this.inventory.create(input));
        } catch (error) {
            checkUniqueConflict(error);
            throw error;
        }
    }

    async list(_user: AuthenticatedUser, query: InventoryListQuery) {
        const result = await this.inventory.list(query);
        return {
            data: result.records.map(toInventoryListItem),
            meta: { page: query.page, pageSize: query.pageSize, total: result.total, totalPages: Math.ceil(result.total / query.pageSize) },
        };
    }

    async detail(_user: AuthenticatedUser, id: string) {
        const record = await this.inventory.findById(id);
        if (!record) fail(404, "INVENTORY_ITEM_NOT_FOUND", "El artículo de inventario no existe.");
        return toInventoryDetail(record);
    }

    async patch(_user: AuthenticatedUser, id: string, patch: InventoryPatchBody) {
        const changes = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as InventoryPatchInput;
        try {
            const record = await this.inventory.patchLocked(id, async (current, update) => {
                if (!current) fail(404, "INVENTORY_ITEM_NOT_FOUND", "El artículo de inventario no existe.");
                const merged = { ...current, ...changes };
                validateByType(merged);
                if (sameValue(current, changes)) return current;
                return update(changes);
            });
            return toInventoryDetail(record);
        } catch (error) {
            checkUniqueConflict(error);
            throw error;
        }
    }

    async remove(_user: AuthenticatedUser, id: string): Promise<void> {
        if (await this.inventory.softDelete(id)) return;
        if (!(await this.inventory.findById(id))) fail(404, "INVENTORY_ITEM_NOT_FOUND", "El artículo de inventario no existe.");
    }

    async tickets(_user: AuthenticatedUser, id: string, query: InventoryHistoryQuery) {
        if (!(await this.inventory.findById(id))) fail(404, "INVENTORY_ITEM_NOT_FOUND", "El artículo de inventario no existe.");
        const result = await this.inventory.listTickets(id, query);
        return {
            data: result.records.map(toInventoryHistoryItem),
            meta: { page: query.page, pageSize: query.pageSize, total: result.total, totalPages: Math.ceil(result.total / query.pageSize) },
        };
    }
}

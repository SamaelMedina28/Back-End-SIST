import { randomUUID } from "node:crypto";
import { InventoryType, TicketStatus } from "../generated/prisma/client.js";
import { describe, expect, it, vi } from "vitest";
import { inventoryCreateSchema, inventoryListQuerySchema, inventoryPatchSchema } from "../src/modules/inventory/inventory.schema.js";
import { InventoryService, toInventoryDetail, toInventoryHistoryItem, toInventoryListItem } from "../src/modules/inventory/inventory.service.js";
import type { InventoryHistoryQuery, InventoryHistoryRecord, InventoryListQuery, InventoryPatchInput, InventoryRecord, InventoryRepository } from "../src/modules/inventory/inventory.types.js";

const computer = {
    type: "COMPUTER", model: " Dell OptiPlex 7090 ", assetCode: " PAT-00421 ", color: " Negro ", size: " SFF ",
    building: " Edificio 6 ", room: " 603 ", serialNumber: " DX92K1 ", quantity: 1, notes: "  ",
};

function record(overrides: Partial<InventoryRecord> = {}): InventoryRecord {
    const now = new Date("2026-10-04T12:00:00Z");
    return {
        id: randomUUID(), type: InventoryType.COMPUTER, model: "Dell OptiPlex 7090", assetCode: "PAT-00421",
        color: "Negro", size: "SFF", building: "Edificio 6", room: "603", serialNumber: "DX92K1", quantity: 1,
        notes: null, isActive: true, createdAt: now, updatedAt: now, ...overrides,
    };
}

class MemoryInventoryRepository implements InventoryRepository {
    item = record();
    update = vi.fn(async (data: InventoryPatchInput) => this.item = { ...this.item, ...data, updatedAt: new Date() });
    async create() { return this.item; }
    async list(_query: InventoryListQuery) { return { records: [this.item], total: 1 }; }
    async findById(id: string) { return this.item.id === id ? this.item : null; }
    async patchLocked(_id: string, operation: (value: InventoryRecord | null, update: (data: InventoryPatchInput) => Promise<InventoryRecord>) => Promise<InventoryRecord>) {
        return operation(this.item, this.update);
    }
    async softDelete() { return true; }
    async listTickets(_id: string, _query: InventoryHistoryQuery) { return { records: [] as InventoryHistoryRecord[], total: 0 }; }
}

describe("inventory schemas", () => {
    it.each([
        ["COMPUTER", computer],
        ["PROJECTOR", { type: "PROJECTOR", model: " Epson EB-992F ", assetCode: " PR-21 ", color: "Blanco", size: "Mediano" }],
        ["CONTROL", { type: "CONTROL", model: "Control remoto", quantity: 8, assetCode: "" }],
        ["ADAPTER", { type: "ADAPTER", model: "Adaptador HDMI", quantity: 2 }],
    ])("acepta la forma requerida de %s y normaliza strings", (_type, body) => {
        const result = inventoryCreateSchema.parse(body);
        expect(result.model).not.toMatch(/^\s|\s$/u);
        expect(result.notes).toBe(null);
    });

    it("valida requisitos discriminados y cantidad individual", () => {
        expect(inventoryCreateSchema.safeParse({ ...computer, serialNumber: " " }).success).toBe(false);
        expect(inventoryCreateSchema.safeParse({ ...computer, quantity: 2 }).success).toBe(false);
        expect(inventoryCreateSchema.safeParse({ ...computer, type: "PROJECTOR", assetCode: undefined, serialNumber: null }).success).toBe(false);
        expect(inventoryCreateSchema.safeParse({ type: "CONTROL", model: "Control", quantity: 0 }).success).toBe(false);
        expect(inventoryCreateSchema.safeParse({ type: "ADAPTER", model: "Adaptador", quantity: -1 }).success).toBe(false);
        expect(inventoryCreateSchema.safeParse({ type: "ADAPTER", model: "Adaptador", quantity: 1, mystery: true }).success).toBe(false);
    });

    it("acepta patch vacío, pero rechaza type, isActive y otros campos fuera de lista", () => {
        expect(inventoryPatchSchema.parse({})).toEqual({});
        expect(inventoryPatchSchema.safeParse({ type: "PROJECTOR" }).success).toBe(false);
        expect(inventoryPatchSchema.safeParse({ isActive: true }).success).toBe(false);
    });

    it("usa defaults de listado, filtros validados y active=false explícito", () => {
        expect(inventoryListQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20, active: true });
        expect(inventoryListQuerySchema.parse({ active: "false", type: "ADAPTER" })).toMatchObject({ active: false, type: "ADAPTER" });
        expect(inventoryListQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
        expect(inventoryListQuerySchema.safeParse({ type: "TABLE" }).success).toBe(false);
        expect(inventoryListQuerySchema.safeParse({ includeInactive: "true" }).success).toBe(false);
    });
});

describe("inventory service and serializers", () => {
    const user = { id: randomUUID(), role: "ADMIN", supportAreas: [] } as never;

    it("validates the merged record on patch and leaves required COMPUTER series intact", async () => {
        const repository = new MemoryInventoryRepository();
        const service = new InventoryService(repository);
        await expect(service.patch(user, repository.item.id, { serialNumber: null })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        expect(repository.update).not.toHaveBeenCalled();
        await service.patch(user, repository.item.id, { room: "604" });
        expect(repository.item.room).toBe("604");
    });

    it("does not write a no-op patch", async () => {
        const repository = new MemoryInventoryRepository();
        await new InventoryService(repository).patch(user, repository.item.id, { room: "603" });
        expect(repository.update).not.toHaveBeenCalled();
    });

    it("serializes list, detail, and history explicitly", () => {
        const item = record();
        expect(toInventoryListItem(item)).toEqual(expect.objectContaining({ id: item.id, location: { building: item.building, room: item.room } }));
        expect(toInventoryListItem(item)).not.toHaveProperty("notes");
        expect(toInventoryDetail(item)).toMatchObject({ building: item.building, room: item.room, notes: null });
        const history = toInventoryHistoryItem({
            id: randomUUID(), code: "TK-000123", title: "Falla", priority: "HIGH", status: TicketStatus.COMPLETED,
            reporterNameSnapshot: "Nombre histórico", createdAt: new Date(), completedAt: null,
            category: { id: randomUUID(), name: "Falla de equipo" }, subcategory: null,
        });
        expect(history.reporter.fullName).toBe("Nombre histórico");
        expect(history.reporter).not.toHaveProperty("id");
    });
});

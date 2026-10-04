import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import type { InventoryCreateInput, InventoryHistoryQuery, InventoryHistoryRecord, InventoryListQuery, InventoryPatchInput, InventoryRecord, InventoryRepository } from "./inventory.types.js";

const ticketHistorySelect = {
    id: true,
    code: true,
    title: true,
    priority: true,
    status: true,
    reporterNameSnapshot: true,
    createdAt: true,
    completedAt: true,
    category: { select: { id: true, name: true } },
    subcategory: { select: { id: true, name: true } },
} satisfies Prisma.TicketSelect;

export class PrismaInventoryRepository implements InventoryRepository {
    constructor(private readonly prisma: PrismaClient) {}

    create(input: InventoryCreateInput): Promise<InventoryRecord> {
        return this.prisma.inventoryItem.create({ data: input }) as Promise<InventoryRecord>;
    }

    async list(query: InventoryListQuery): Promise<{ records: InventoryRecord[]; total: number }> {
        const where: Prisma.InventoryItemWhereInput = {
            isActive: query.active,
            ...(query.type ? { type: query.type } : {}),
            ...(query.building ? { building: { equals: query.building, mode: "insensitive" } } : {}),
            ...(query.search ? { OR: [
                { model: { contains: query.search, mode: "insensitive" } },
                { assetCode: { contains: query.search, mode: "insensitive" } },
                { serialNumber: { contains: query.search, mode: "insensitive" } },
                { building: { contains: query.search, mode: "insensitive" } },
                { room: { contains: query.search, mode: "insensitive" } },
            ] } : {}),
        };
        const [records, total] = await this.prisma.$transaction([
            this.prisma.inventoryItem.findMany({
                where,
                orderBy: [{ createdAt: "desc" }, { id: "asc" }],
                skip: (query.page - 1) * query.pageSize,
                take: query.pageSize,
            }),
            this.prisma.inventoryItem.count({ where }),
        ]);
        return { records: records as InventoryRecord[], total };
    }

    findById(id: string): Promise<InventoryRecord | null> {
        return this.prisma.inventoryItem.findUnique({ where: { id } }) as Promise<InventoryRecord | null>;
    }

    async patchLocked(
        id: string,
        operation: (record: InventoryRecord | null, update: (data: InventoryPatchInput) => Promise<InventoryRecord>) => Promise<InventoryRecord>,
    ): Promise<InventoryRecord> {
        return this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "InventoryItem" WHERE "id" = ${id}::uuid FOR UPDATE`;
            const record = await tx.inventoryItem.findUnique({ where: { id } }) as InventoryRecord | null;
            return operation(record, async (data) => await tx.inventoryItem.update({ where: { id }, data }) as InventoryRecord);
        }, { maxWait: 10000, timeout: 20000 });
    }

    async softDelete(id: string): Promise<boolean> {
        const result = await this.prisma.inventoryItem.updateMany({ where: { id, isActive: true }, data: { isActive: false } });
        return result.count > 0;
    }

    async listTickets(id: string, query: InventoryHistoryQuery): Promise<{ records: InventoryHistoryRecord[]; total: number }> {
        const where: Prisma.TicketWhereInput = {
            inventoryItemId: id,
            ...(query.status ? { status: query.status } : {}),
            ...(query.from || query.to ? { createdAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
            } } : {}),
        };
        const [records, total] = await this.prisma.$transaction([
            this.prisma.ticket.findMany({
                where,
                select: ticketHistorySelect,
                orderBy: [{ createdAt: "desc" }, { id: "asc" }],
                skip: (query.page - 1) * query.pageSize,
                take: query.pageSize,
            }),
            this.prisma.ticket.count({ where }),
        ]);
        return { records: records as InventoryHistoryRecord[], total };
    }
}
